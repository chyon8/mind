import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmDelete } from '@/lib/confirm';
import { feedDateLabel } from '@/lib/dates';
import { Markdown } from '@/lib/markdown';
import {
  askRudy,
  deleteConversation,
  fetchConversations,
  fetchMessages,
  latestConversation,
  newConversation,
  type ChatMessage,
  type Conversation,
} from '@/lib/rudy';
import { fetchFragmentsByIds, recordUtteranceResponse } from '@/lib/supabase';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';

// 근거 칩에 쓸 짧은 이름. 링크는 URL 대신 제목으로 (URL 칩은 읽을 수 없다).
function chipLabel(fr: Fragment): string {
  const raw = (fr.link_title || fr.content || '').replace(/\s+/g, ' ').trim();
  return raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;
}

// 빈 화면의 예시 질문 — 뭘 물어볼 수 있는지 화면이 직접 보여준다. 탭하면 바로 보낸다.
const SUGGESTIONS = [
  '요즘 나 뭐에 꽂혀 있어?',
  '지난주에 뭐 던졌지?',
  '읽으려고 저장해둔 링크 뭐 있었지?',
  '음악 관련 모아둔 거 정리해줘',
];

// 서버에 아직 없는 턴. 저장이 확인되면 messages로 흡수된다.
//
// ⚠️ 배열이다. 예전엔 한 턴만 들고 있어서, 저장이 실패한 뒤 다음 질문을 보내면
// 이전 턴이 통째로 사라졌다("새로 보내면 텍스트가 없어진다"). 화면에 나온 글자는
// 서버가 어떻게 되든 지우지 않는다 — 대화는 로컬에서 무조건 누적된다.
type Turn = { key: string; q: string; a: string; cited: string[]; note?: string };

// Rudy 채팅 (RUDY.md §7-2 당기는 표면). 미는 표면이 아니다 — 내가 열 때만 말한다.
//
// 상태 머신은 단순하게 유지한다: phase는 idle ↔ streaming 둘뿐이고, send의 finally가
// 무조건 idle로 되돌린다. 이전 버전은 실패 경로에서 streaming 상태가 안 풀려
// 두 번째 전송이 영원히 잠겼다 — 어떤 경로로 끝나든 반드시 idle로 돌아와야 한다.
//
// 시각 규칙: 파편은 카드에 담기지만 Rudy의 말은 담기지 않는다. 왼쪽 세로 규칙 하나만
// 두고 본문으로 흐른다 — 여백에 적힌 사서의 메모처럼. 유저 말은 오른쪽 카드로 접힌다.
export default function Chat() {
  // 원탭 진입 (§4-C1) — 파편 상세의 칩이 질문을 들고 들어온다
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<'idle' | 'streaming'>('idle');
  const [turns, setTurns] = useState<Turn[]>([]); // 서버에 아직 없는 것들 (누적)
  const [history, setHistory] = useState<Conversation[] | null>(null); // null = 시트 닫힘
  const [historyError, setHistoryError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 자발적 연결로 나온 파편 → 원장 id. 그 파편을 열면 루디에 대한 acted다 (§6-6).
  const linked = useRef<Record<string, string>>({});
  const autoSent = useRef(false);
  const insets = useSafeAreaInsets();

  // 근거 칩 이름은 파편을 따로 읽어야 안다 (messages엔 id만 있다)
  const loadLabels = useCallback(async (msgs: ChatMessage[]) => {
    const ids = Array.from(new Set(msgs.flatMap((m) => m.cited_ids ?? [])));
    if (ids.length === 0) return;
    const frs = await fetchFragmentsByIds(ids);
    setLabels((prev) => ({ ...prev, ...Object.fromEntries(frs.map((f) => [f.id, chipLabel(f)])) }));
  }, []);

  const open = useCallback(
    async (id: string) => {
      setConversationId(id);
      const msgs = await fetchMessages(id);
      setMessages(msgs);
      loadLabels(msgs).catch(() => {}); // 칩 이름은 나중에 채워져도 된다
      return msgs;
    },
    [loadLabels],
  );

  useEffect(() => {
    latestConversation()
      .then((id) => (id ? open(id) : undefined))
      .catch(() => {});
  }, [open]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || phase !== 'idle') return;
      setInput('');
      setPhase('streaming');

      // 이 턴을 먼저 화면에 붙이고 시작한다. 이후 무슨 일이 나든 이 줄은 지우지 않는다.
      const key = `${Date.now()}`;
      const patch = (p: Partial<Turn>) =>
        setTurns((prev) => prev.map((t) => (t.key === key ? { ...t, ...p } : t)));
      setTurns((prev) => [...prev, { key, q: text, a: '', cited: [] }]);

      let answer = '';
      try {
        // 대화 행은 첫 전송 때 만든다 (지연 생성 — rudy.ts 참고)
        const convId = conversationId ?? (await newConversation());
        if (convId !== conversationId) setConversationId(convId);

        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const saved = await askRudy(
          convId,
          text,
          {
            onToken: (t) => {
              answer += t;
              patch({ a: answer });
            },
            // 근거는 스트림 맨 앞에 온다 — 저장이 되든 안 되든 칩을 그릴 수 있다
            onCite: (ids) => {
              patch({ cited: ids });
              fetchFragmentsByIds(ids)
                .then((frs) =>
                  setLabels((prev) => ({
                    ...prev,
                    ...Object.fromEntries(frs.map((f) => [f.id, chipLabel(f)])),
                  })),
                )
                .catch(() => {});
            },
            onLink: (fragmentId, utteranceId) => {
              linked.current[fragmentId] = utteranceId;
            },
          },
          ctrl.signal,
        );

        // 저장이 확인되면 서버 이력으로 승격하고 로컬 턴을 거둔다.
        // 확인 안 되면 로컬 턴을 그대로 둔다 — 화면의 글자는 어떤 경우에도 사라지지 않는다.
        if (saved) {
          const msgs = await open(convId);
          if (msgs.some((m) => m.role === 'assistant')) {
            setTurns((prev) => prev.filter((t) => t.key !== key));
            return;
          }
        }
        patch({ note: '기록에 저장되지 않았다 (이 화면에서는 계속 보인다)' });
      } catch (e: unknown) {
        if ((e as Error)?.name === 'AbortError') {
          patch({ note: '중단됨' }); // 부분 답은 남긴다 — 서버도 받은 데까지 저장한다
        } else {
          console.warn('[chat]', e);
          patch({ note: answer ? `연결이 끊겼다: ${(e as Error)?.message ?? e}` : `답을 못 가져왔다: ${(e as Error)?.message ?? e}` });
        }
      } finally {
        // 어떤 경로로 끝나든 반드시 idle — 다음 전송이 잠기면 안 된다
        abortRef.current = null;
        setPhase('idle');
      }
    },
    [conversationId, phase, open],
  );

  // 원탭 진입은 타이핑 없이 바로 물어본다 — 프리필만 하면 결국 한 번 더 눌러야 한다.
  // send를 ref로 참조해 effect가 send 재생성마다 다시 돌지 않게 한다.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (q && !autoSent.current) {
      autoSent.current = true;
      sendRef.current(q);
    }
  }, [q]);

  // 마크다운 링크 라우팅: mind://fragment/… → 파편 상세, mind://project/… → 프로젝트 상세,
  // 그 외(http…)는 브라우저로. 자발적 연결이었던 파편이면 acted를 적는다(§6-6).
  const onLink = useCallback((href: string) => {
    const frag = href.match(/^mind:\/\/fragment\/(.+)$/);
    const proj = href.match(/^mind:\/\/project\/(.+)$/);
    if (frag) {
      const utteranceId = linked.current[frag[1]];
      if (utteranceId) recordUtteranceResponse(utteranceId, 'acted').catch(() => {});
      router.push(`/fragment/${frag[1]}`);
    } else if (proj) {
      router.push(`/projects/${proj[1]}`);
    } else if (/^https?:\/\//.test(href)) {
      Linking.openURL(href).catch(() => {});
    }
  }, []);

  function openFragment(id: string) {
    onLink(`mind://fragment/${id}`);
  }

  function startNew() {
    if (phase !== 'idle') return;
    setConversationId(null); // 행은 다음 전송 때 만들어진다
    setMessages([]);
    setTurns([]);
  }

  async function removeConversation(c: Conversation) {
    if (!(await confirmDelete('이 대화를 지울까? 파편은 그대로 남는다.'))) return;
    await deleteConversation(c.id);
    setHistory((prev) => (prev ?? []).filter((x) => x.id !== c.id));
    if (c.id === conversationId) startNew();
  }

  const streamingNow = phase === 'streaming';
  const empty = messages.length === 0 && turns.length === 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 뒤로</Text>
          </Pressable>
          <Text style={styles.wordmark}>RUDY</Text>
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => {
                // 시트를 먼저 연다 — 예전엔 조회 실패를 삼켜서 버튼을 눌러도 아무 일이
                // 안 일어났다("대화내역이 아예 안 뜬다"). 실패는 시트 안에 적는다.
                setHistory([]);
                setHistoryError(null);
                fetchConversations()
                  .then(setHistory)
                  .catch((e) => setHistoryError(String(e?.message ?? e)));
              }}
              hitSlop={12}
            >
              <Text style={styles.headerBtn}>기록</Text>
            </Pressable>
            <Pressable onPress={startNew} hitSlop={12}>
              <Text style={styles.headerBtn}>새로</Text>
            </Pressable>
          </View>
        </View>

        {/* flex:1이 없으면 답변이 길어질 때 스크롤뷰가 컨테이너를 밀어내
            입력창이 화면 밖으로 나간다 — 지난 버그. */}
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {empty && (
            <View style={styles.emptyWrap}>
              <Text style={styles.empty}>던져둔 것 위에서 얘기한다.</Text>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} style={styles.suggestion} onPress={() => send(s)}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <View key={m.id} style={styles.userRow}>
                <Text style={styles.userText}>{m.content}</Text>
              </View>
            ) : (
              <View key={m.id} style={styles.rudyBlock}>
                <Markdown text={m.content} onLink={onLink} />
                {(m.cited_ids ?? []).length > 0 && (
                  <View style={styles.chips}>
                    {m.cited_ids.map((id) =>
                      labels[id] ? (
                        <Pressable key={id} style={styles.chip} onPress={() => openFragment(id)}>
                          <Text style={styles.chipText}>{labels[id]}</Text>
                        </Pressable>
                      ) : null,
                    )}
                  </View>
                )}
              </View>
            ),
          )}

          {turns.map((t, i) => (
            <View key={t.key} style={styles.turn}>
              <View style={styles.userRow}>
                <Text style={styles.userText}>{t.q}</Text>
              </View>
              <View style={styles.rudyBlock}>
                {t.a ? (
                  <Markdown text={t.a} onLink={onLink} />
                ) : streamingNow && i === turns.length - 1 ? (
                  <ActivityIndicator color={colors.faint} style={styles.thinking} />
                ) : null}
                {/* 근거 칩은 모델이 링크를 안 걸어도 항상 보인다 — 검색과 같은 수준의 결과 노출 */}
                {t.cited.length > 0 && (
                  <View style={styles.chips}>
                    {t.cited.map((id) =>
                      labels[id] ? (
                        <Pressable key={id} style={styles.chip} onPress={() => openFragment(id)}>
                          <Text style={styles.chipText}>{labels[id]}</Text>
                        </Pressable>
                      ) : null,
                    )}
                  </View>
                )}
                {t.note && <Text style={styles.note}>{t.note}</Text>}
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={[styles.composer, { marginBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <TextInput
            style={[styles.input, noFocusRing]}
            value={input}
            onChangeText={setInput}
            placeholder="물어보기"
            placeholderTextColor={colors.faint}
            multiline
          />
          {streamingNow ? (
            // 응답 중엔 보내기가 중단으로 바뀐다 — 긴 답을 앉아서 다 볼 이유가 없다
            <Pressable onPress={() => abortRef.current?.abort()} style={styles.send} hitSlop={8}>
              <Text style={styles.sendIcon}>■</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => send(input)}
              disabled={!input.trim()}
              style={[styles.send, !input.trim() && styles.sendOff]}
              hitSlop={8}
            >
              <Text style={[styles.sendIcon, !input.trim() && styles.sendIconOff]}>↑</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      {history !== null && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setHistory(null)}
        >
          <SafeAreaView style={styles.screen} edges={['top']}>
            <View style={styles.header}>
              <Pressable onPress={() => setHistory(null)} hitSlop={12}>
                <Text style={styles.headerBtn}>닫기</Text>
              </Pressable>
              <Text style={styles.wordmark}>기록</Text>
              <View style={styles.headerRight} />
            </View>
            <ScrollView contentContainerStyle={styles.historyList}>
              {historyError && <Text style={styles.errorText}>불러오기 실패: {historyError}</Text>}
              {!historyError && history.length === 0 && (
                <Text style={styles.empty}>아직 나눈 얘기가 없다</Text>
              )}
              {history.map((c) => (
                <View
                  key={c.id}
                  style={[styles.historyRow, c.id === conversationId && styles.historyRowActive]}
                >
                  <Pressable
                    style={styles.historyBody}
                    onPress={() => {
                      setHistory(null);
                      if (phase === 'idle') open(c.id).catch(() => {});
                    }}
                  >
                    <Text style={styles.historyTitle} numberOfLines={1}>
                      {c.title ?? '빈 대화'}
                    </Text>
                    <Text style={styles.historyDate}>{feedDateLabel(c.created_at)}</Text>
                  </Pressable>
                  {/* 삭제는 보이는 버튼으로 — 롱프레스는 아무도 발견 못 한다 */}
                  <Pressable onPress={() => removeConversation(c)} hitSlop={12}>
                    <Text style={styles.historyDelete}>지우기</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const SEND_SIZE = 32;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerBtn: { ...type.labelSm, color: colors.mute, fontFamily: fonts.sans },
  headerRight: { flexDirection: 'row', gap: spacing.md, minWidth: 72, justifyContent: 'flex-end' },
  wordmark: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },

  list: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  emptyWrap: { marginTop: spacing.xxl, gap: spacing.sm, alignItems: 'flex-start' },
  empty: { ...type.bodyMd, color: colors.faint, fontFamily: fonts.sans, marginBottom: spacing.xs },
  suggestion: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  suggestionText: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },

  // 유저 말은 오른쪽 카드로 접힌다 — 지나간 것이다
  userRow: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  userText: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },

  // 루디 말은 카드에 안 담는다 — 이 화면의 본문이다.
  // 왼쪽 규칙 하나로 파편 카드와 구분된다 (여백의 메모).
  rudyBlock: {
    gap: spacing.sm,
    borderLeftColor: colors.hairline,
    borderLeftWidth: 2,
    paddingLeft: spacing.md,
  },
  thinking: { alignSelf: 'flex-start' },
  note: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  chipText: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },

  // 입력창은 한 줄짜리 밑줄이 아니라 넉넉한 필드다 — 길게 물어볼 수 있어야 한다
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    padding: spacing.xs,
    paddingLeft: spacing.sm,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.lg,
  },
  input: {
    flex: 1,
    minHeight: SEND_SIZE,
    maxHeight: 140,
    ...type.bodyMd,
    color: colors.ink,
    fontFamily: fonts.sans,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: SEND_SIZE / 2,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: colors.hairline },
  sendIcon: { ...type.bodyMd, color: colors.onInk, fontFamily: fonts.sansSemiBold },
  sendIconOff: { color: colors.faint },

  turn: { gap: spacing.lg },
  errorText: { ...type.bodySm, color: colors.error, fontFamily: fonts.sans },
  historyList: { padding: spacing.md, gap: spacing.xxs },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: rounded.sm,
    gap: spacing.md,
  },
  historyRowActive: { backgroundColor: colors.canvasElevated },
  historyBody: { flex: 1, gap: spacing.xxs },
  historyTitle: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sans },
  historyDate: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans },
  historyDelete: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
});
