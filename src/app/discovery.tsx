import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatCost } from '@/lib/cost';
import { feedDateLabel, formatTime } from '@/lib/dates';
import { Markdown } from '@/lib/markdown';
import { type Briefing, deleteBriefing, fetchBriefings } from '@/lib/rudy';
import {
  existingFragmentContents,
  fetchFragmentProjectMap,
  fetchProjects,
  insertFragment,
  updateFragment,
  setFragmentProjects,
  touchFragment,
} from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Project } from '@/lib/types';

// 발견 브리핑 (RUDY.md §4-E · §7-4). 당기는 표면 — 내가 열 때만 바깥을 물어온다.
//
// **이 화면은 읽기 전용이다** (2026-08-02, 유저 지시: "발견도 클코만 남기고 앱버튼 없애").
// 만드는 건 맥에서 `node scripts/discover-websearch/run.mjs`가 한다 — 앱은 원장을 읽어 보여줄 뿐이다.
// 같은 날 삭제한 것: `새로 발견하기`(Edge `discovery` 스트리밍)와 `모닝 브리핑 만들기`.
// 후자는 아침 브리핑이 자기 표면(`/morning`)을 갖게 되면서 이름만 겹치는 옛 물건이 됐다.
//
// ⚠️ Edge Function `discovery`는 **안 지웠다.** 부르는 사람이 없으면 안 돈다. 되살릴 때 배포부터
//    다시 하지 않으려고 남겼다 — `streamBriefing`(`lib/rudy.ts`)도 같은 이유로 남아 있다.

function openLink(href: string) {
  if (/^https?:\/\//.test(href)) Linking.openURL(href).catch(() => {});
}

// "버린 것/못 찾은 것" 각주 감지. ※ 가 정식이지만, 구버전 브리핑은 ※ 없이 마지막에 붙어 있어
// 문구로도 잡는다(유저: "이걸 왜 카드에 그대로 넣어").
const REJECT_RE = /(뺐|뺀\s|제외|리스티클|못 찾|버린\s*것|안 넣)/;

type CardData = { title: string; body: string; slot: string };

// 제목 앞에 붙는 슬롯 라벨 — `### [아이디어] 제목` (brief.ts ASSEMBLE_SYS가 찍는다).
// 라벨은 제목에서 떼어내 배지로 따로 보여준다. 없으면(구버전 브리핑) 그냥 빈 문자열이다.
const SLOT_RE = /^\[([^\]]{1,10})\]\s*(.*)$/;

// 스트리밍 마크다운을 카드로 쪼갠다 — ### 제목마다 한 장. 미완성이어도 안 죽는다.
function parseCards(md: string): CardData[] {
  const cards: CardData[] = [];
  let cur: CardData | null = null;
  for (const ln of md.split('\n')) {
    const h = ln.match(/^###\s+(.+)/);
    if (h) {
      const m = h[1].trim().match(SLOT_RE);
      cur = { title: (m ? m[2] : h[1]).trim(), slot: m ? m[1].trim() : '', body: '' };
      cards.push(cur);
    } else if (ln.trimStart().startsWith('※')) {
      cards.push({ title: '', slot: '', body: ln.replace(/^\s*※\s*/, '').trim() }); // 정식 각주
      cur = null;
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + ln;
    } else if (ln.trim()) {
      cards.push({ title: '', slot: '', body: ln });
    }
  }

  // 구버전 대비: 마지막 카드 본문 끝에 "…뺐다/제외" 문단이 붙어 있으면 떼어 각주로.
  const last = [...cards].reverse().find((c) => c.title);
  if (last) {
    const paras = last.body.split(/\n{2,}/);
    const tail = paras[paras.length - 1] ?? '';
    if (paras.length > 1 && REJECT_RE.test(tail) && tail.length < 220) {
      paras.pop();
      last.body = paras.join('\n\n');
      cards.push({ title: '', slot: '', body: tail.trim() });
    }
  }

  return cards.map((c) => ({ ...c, body: c.body.trim() })).filter((c) => c.title || c.body);
}

const firstTitle = (md: string) => parseCards(md).find((c) => c.title)?.title ?? '(제목 없음)';

// 카드 하나 — 처음 나타날 때 페이드+슬라이드. index를 key로 쓰므로 마지막 카드는 자라기만 한다.
// 던지기(§4-E4 플라이휠): 발견 인사이트를 그대로 Mind 파편으로. 임베딩돼서 다음 충돌·클러스터에 참여한다.
function Card({
  title,
  body,
  slot,
  thrown,
  onThrow,
  memo,
  onMemoChange,
  onMemoBlur,
  projects,
  assignedIds,
  onToggleProject,
}: {
  title: string;
  body: string;
  slot: string; // 확장 / 아이디어 / 관점 / 되꺼냄. 구버전 브리핑은 빈 문자열이라 배지가 안 뜬다
  thrown: boolean;
  onThrow: () => void;
  // 던진 뒤에만 여는 메모 (프로젝트 칩과 같은 자리 — 던지기 자체는 마찰 0 유지).
  // 쓴 걸 blur에서 파편의 덧붙임으로 저장한다.
  memo: string;
  onMemoChange: (text: string) => void;
  onMemoBlur: () => void;
  // 던진 뒤에만 펼쳐지는 프로젝트 칩 (유저 요청, 2026-07-22) — 던지기 자체는 마찰 0 유지,
  // 프로젝트 지정은 완전히 선택. projects가 빈 배열이면 칩 자체가 안 뜬다(지을 곳이 없다).
  projects: Project[];
  assignedIds: string[];
  onToggleProject: (projectId: string) => void;
}) {
  // 그냥 탭했다 나가는 것만으론(안 쓰고 blur) 기존 덧붙임을 빈 문자열로 덮어쓰지 않는다
  const memoTouched = useRef(false);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);
  const style = {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };
  if (!title) {
    return (
      <Animated.View style={style}>
        <Text style={styles.footnote}>{body}</Text>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[styles.card, style]}>
      {!!slot && (
        <Text style={[styles.slotBadge, slot === '아이디어' && styles.slotBadgeIdea]}>{slot}</Text>
      )}
      <Text style={styles.cardTitle}>{title}</Text>
      {!!body && <Markdown text={body} onLink={openLink} />}
      <Pressable onPress={onThrow} disabled={thrown} hitSlop={6} style={styles.throw}>
        <Text style={[styles.throwText, thrown && styles.thrownText]}>
          {thrown ? '던졌다 ✓' : '↑ 던지기'}
        </Text>
      </Pressable>
      {thrown && (
        <TextInput
          style={styles.memoInput}
          multiline
          value={memo}
          onChangeText={(text) => {
            memoTouched.current = true;
            onMemoChange(text);
          }}
          onBlur={() => {
            if (memoTouched.current) onMemoBlur();
          }}
          placeholder="덧붙일 생각 (선택)"
          placeholderTextColor={colors.faint}
          keyboardAppearance="dark"
        />
      )}
      {thrown && projects.length > 0 && (
        <View style={styles.projectRow}>
          {projects.map((p) => {
            const active = assignedIds.includes(p.id);
            return (
              <Pressable
                key={p.id}
                onPress={() => onToggleProject(p.id)}
                style={[styles.projectChip, active && styles.projectChipActive]}
              >
                <Text style={[styles.projectChipText, active && styles.projectChipTextActive]}>
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
}

type Mode = 'home' | 'result';

export default function Discovery() {
  const [mode, setMode] = useState<Mode>('home');
  const [md, setMd] = useState('');
  const [list, setList] = useState<Briefing[]>([]);
  // 화면이 떠 있는 동안만 setState.
  const alive = useRef(true);
  const started = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refreshList = useCallback(() => {
    fetchBriefings()
      .then((bs) => alive.current && setList(bs))
      .catch(() => {});
  }, []);

  // 프로젝트 칩(던진 뒤 지정용) — 목록 한 번만 읽어둔다
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    fetchProjects()
      .then((ps) => alive.current && setProjects(ps))
      .catch(() => {});
  }, []);

  // 던지기(§4-E4) 상태. 화면을 나갔다 와도 이미 던진 카드는 "던졌다"로 뜨게 DB에서 복원한다.
  // title → fragment id (프로젝트 칩을 누르려면 어느 파편인지 알아야 한다).
  const [thrown, setThrown] = useState<Set<string>>(new Set());
  const [thrownIds, setThrownIds] = useState<Record<string, string>>({});
  const [cardProjects, setCardProjects] = useState<Record<string, string[]>>({});
  // 던지기 전에 카드마다 미리 써두는 메모 — title을 키로 쓴다(projects/thrown과 같은 방식)
  const [cardMemos, setCardMemos] = useState<Record<string, string>>({});
  const syncThrown = useCallback((text: string) => {
    const titles = parseCards(text).map((c) => c.title).filter(Boolean);
    if (!titles.length) return;
    existingFragmentContents(titles)
      .then(async (hit) => {
        if (!alive.current || !hit.length) return;
        setThrown((s) => new Set([...s, ...hit.map((h) => h.content)]));
        setThrownIds((prev) => ({
          ...prev,
          ...Object.fromEntries(hit.map((h) => [h.content, h.id])),
        }));
        // 이미 지정돼 있던 프로젝트가 있으면 칩 활성 상태로 복원
        const byFrag = await fetchFragmentProjectMap(hit.map((h) => h.id));
        if (!alive.current) return;
        setCardProjects((prev) => ({
          ...prev,
          ...Object.fromEntries(hit.map((h) => [h.content, byFrag[h.id] ?? []])),
        }));
      })
      .catch(() => {});
  }, []);

  const toggleCardProject = useCallback(
    (title: string, projectId: string) => {
      const id = thrownIds[title];
      if (!id) return;
      const current = cardProjects[title] ?? [];
      const next = current.includes(projectId)
        ? current.filter((pid) => pid !== projectId)
        : [...current, projectId];
      setCardProjects((prev) => ({ ...prev, [title]: next })); // 낙관적 반영
      setFragmentProjects(id, next)
        .then(() => touchFragment(id))
        .catch(() => setCardProjects((prev) => ({ ...prev, [title]: current }))); // 실패하면 되돌린다
    },
    [thrownIds, cardProjects],
  );

  // 열 때: 기록 목록을 읽어 보여준다.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    refreshList();
  }, [refreshList]);

  const view = useCallback(
    (b: Briefing) => {
      setMd(b.text);
      setMode('result');
      syncThrown(b.text);
    },
    [syncThrown],
  );

  const remove = useCallback(
    (b: Briefing) => {
      setList((cur) => cur.filter((x) => x.id !== b.id)); // 낙관적 제거
      deleteBriefing(b.id).catch(() => refreshList()); // 실패하면 되돌린다
    },
    [refreshList],
  );

  // 덧붙임이 링크를 클릭 가능하게 렌더하므로(Markdown) 마크업을 그대로 남긴다.
  const throwCard = useCallback((title: string, body: string) => {
    setThrown((s) => new Set(s).add(title));
    const note = body.trim() || null;
    insertFragment({ content: title, type: 'text', note })
      .then((fr) => {
        // id를 잡아둬야 던진 뒤 프로젝트 칩을 누를 수 있다 (유저 요청, 2026-07-22)
        setThrownIds((prev) => ({ ...prev, [title]: fr.id }));
        setCardProjects((prev) => ({ ...prev, [title]: [] }));
      })
      .catch(() =>
        setThrown((s) => {
          const n = new Set(s);
          n.delete(title);
          return n;
        }),
      );
  }, []);

  // 던진 뒤 메모를 쓰면 그 파편의 덧붙임으로 저장한다 — 원래 카드 본문 위에 얹는다.
  const saveCardMemo = useCallback(
    (title: string, body: string, memo: string) => {
      const fragId = thrownIds[title];
      if (!fragId) return;
      const note = [memo.trim(), body.trim()].filter(Boolean).join('\n\n') || null;
      updateFragment(fragId, { note }).catch(() => {});
    },
    [thrownIds],
  );

  const cards = mode === 'result' ? parseCards(md) : [];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        {mode === 'home' ? (
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 뒤로</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setMode('home')} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 목록</Text>
          </Pressable>
        )}
        <Text style={styles.wordmark}>발견</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
        {mode === 'home' && (
          <>
            {list.length === 0 && (
              <Text style={styles.emptyList}>
                아직 기록이 없다. 맥에서 `node scripts/discover-websearch/run.mjs`.
              </Text>
            )}
            {list.map((b) => (
              <Pressable key={b.id} style={styles.histRow} onPress={() => view(b)}>
                <View style={styles.flex}>
                  <View style={styles.histMeta}>
                    {/* 아침 배치가 만든 것과 직접 만든 것을 구분 표시 (유저 요청) */}
                    {b.trigger === 'push' && (
                      <View style={styles.pushBadge}>
                        <Text style={styles.pushBadgeText}>아침</Text>
                      </View>
                    )}
                    <Text style={styles.histDate}>
                      {feedDateLabel(b.created_at)} · {formatTime(b.created_at)}
                    </Text>
                    {/* 이 브리핑이 태운 gpt-5.5 비용 (2026-07-22 유저 요청) */}
                    <Text style={styles.histCost}>{formatCost(b.cost_usd)}</Text>
                  </View>
                  <Text style={styles.histSnip} numberOfLines={1}>
                    {firstTitle(b.text)}
                  </Text>
                </View>
                <Pressable onPress={() => remove(b)} hitSlop={10} style={styles.histDel}>
                  <Text style={styles.histDelText}>지우기</Text>
                </Pressable>
              </Pressable>
            ))}
          </>
        )}

        {cards.map((c, i) => (
          <Card
            key={i}
            title={c.title}
            body={c.body}
            slot={c.slot}
            thrown={thrown.has(c.title)}
            onThrow={() => throwCard(c.title, c.body)}
            memo={cardMemos[c.title] ?? ''}
            onMemoChange={(text) => setCardMemos((prev) => ({ ...prev, [c.title]: text }))}
            onMemoBlur={() => saveCardMemo(c.title, c.body, cardMemos[c.title] ?? '')}
            projects={projects}
            assignedIds={cardProjects[c.title] ?? []}
            onToggleProject={(pid) => toggleCardProject(c.title, pid)}
          />
        ))}

      </ScrollView>

      {/* 발견을 읽다 떠오른 걸 그 자리에서 던진다 — 카드의 "↑ 던지기"(카드 내용을 저장)와는 다르다. */}
      <Pressable style={styles.fab} onPress={() => router.push('/input')}>
        <Text style={styles.fabLabel}>＋ 던지기</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRight: { flexDirection: 'row', gap: spacing.md, minWidth: 44, justifyContent: 'flex-end' },
  wordmark: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 2 },
  headerBtn: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  headerBtnOff: { color: colors.faint },
  // FAB이 마지막 카드를 가리지 않게 바닥 여백을 더 준다
  list: { padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.md },

  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    alignSelf: 'center',
    backgroundColor: colors.ink,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  fabLabel: { ...type.bodyLg, color: colors.onInk, fontFamily: fonts.sansMedium },

  card: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.md ?? 14,
    padding: spacing.md,
    gap: spacing.xs,
  },
  // 슬롯 배지 — 제목 위 한 줄. 카드를 늘리지 않게 작고 조용하게 둔다.
  slotBadge: {
    ...type.bodySm,
    color: colors.faint,
    fontFamily: fonts.sansSemiBold,
    marginBottom: spacing.xxs,
  },
  // 아이디어만 살짝 드러낸다 — 이 사람이 제일 원하는 슬롯이라 한눈에 세어져야 한다.
  slotBadgeIdea: { color: colors.ink },
  cardTitle: { ...type.headingMd, color: colors.ink, fontFamily: fonts.sansSemiBold, marginBottom: spacing.xxs },
  memoInput: {
    ...type.bodyMd,
    color: colors.body,
    fontFamily: fonts.sans,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.sm,
    padding: spacing.sm,
    minHeight: 36,
    textAlignVertical: 'top',
  },
  footnote: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans, fontStyle: 'italic', paddingHorizontal: spacing.xs },
  throw: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  throwText: { ...type.bodySm, color: colors.body, fontFamily: fonts.sansMedium },
  thrownText: { color: colors.faint },
  // 던진 뒤 펼쳐지는 프로젝트 칩 (유저 요청, 2026-07-22) — fragment/[id].tsx의 프로젝트 칩과 같은 결
  projectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs, marginTop: spacing.xs },
  projectChip: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
  },
  projectChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  projectChipText: { ...type.bodySm, color: colors.body, fontFamily: fonts.sans },
  projectChipTextActive: { color: colors.onInk },

  emptyList: { ...type.bodyMd, color: colors.faint, fontFamily: fonts.sans, textAlign: 'center', paddingTop: spacing.lg },

  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  histMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs },
  pushBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: 999,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pushBadgeText: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sansMedium, fontSize: 10 },
  histDate: { ...type.bodySm, color: colors.mute, fontFamily: fonts.mono },
  histCost: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono, marginLeft: spacing.xxs },
  histSnip: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium },
  histDel: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs },
  histDelText: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans },
});
