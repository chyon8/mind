import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AxisShift,
  AxisTimeline,
  BandBar,
  Eyebrow,
  ItemLine,
  QuietRow,
  RhythmBars,
} from '@/components/MorningViz';
import { formatCost } from '@/lib/cost';
import { feedDateLabel, formatTime } from '@/lib/dates';
import {
  answerQuestion,
  deleteMorning,
  fetchMorningById,
  fetchMorningList,
  fetchTodayMorning,
  type MorningBrief,
  type MorningListItem,
} from '@/lib/morning';
import {
  fetchFragmentsByIds,
  letGoFragment,
  recordUtteranceResponse,
  rememberFragment,
} from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';

// 아침 브리핑 전용 화면 (RUDY.md §4-F4).
//
// 데일리에 인라인으로 박지 않는다 — 관찰·축·지형·넛지가 다 들어가면 오늘 파편을 밀어낸다.
// 데일리엔 카드 한 장(MorningCard)만 두고, 내용은 여기 있다.
//
// **여기서 만들지 않는다** (2026-08-02). 만드는 건 맥에서 `node scripts/morning/run.mjs`가 한다 —
// 파편 전량을 읽으려면 클코가 필요하고, 그러면 앱은 아침에 이미 있는 걸 읽기만 하면 된다.
// 스피너도 없고 탭할 때 돈도 안 나간다.
//
// 화면의 순서 = 읽는 순서다. **주장 먼저, 근거는 그 다음.** 숫자를 먼저 보여주면
// 대시보드가 되고, 대시보드는 유저가 스스로 해석해야 하는 숙제를 남긴다(§4-F5의 "서사" 요구).
type Mode = 'detail' | 'list';

export default function MorningScreen() {
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [nudgeFrag, setNudgeFrag] = useState<Fragment | null>(null);
  const [answer, setAnswer] = useState('');
  // 지난 기록 목록 (§4-F4 확장 — 발견 화면과 같은 자리). 기본은 오늘 것 바로 보여주기라
  // discovery.tsx와 달리 'list'가 아니라 'detail'이 초기 모드다 — "열면 이미 있어야 하는 물건"이라서.
  const [mode, setMode] = useState<Mode>('detail');
  const [list, setList] = useState<MorningListItem[]>([]);
  // 목록에서 들어왔는지 — 뒤로가기가 화면을 나갈지 목록으로 돌아갈지 갈린다.
  const [cameFromList, setCameFromList] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const attach = useCallback((b: MorningBrief | null) => {
    setBrief(b);
    setNudgeFrag(null);
    if (!b?.nudge) return;
    fetchFragmentsByIds([b.nudge.fragmentId])
      .then(([fr]) => alive.current && setNudgeFrag(fr ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchTodayMorning()
      .then((b) => alive.current && attach(b))
      .catch(() => {});
  }, [attach]);

  const refreshList = useCallback(() => {
    fetchMorningList()
      .then((l) => alive.current && setList(l))
      .catch(() => {});
  }, []);

  const openList = useCallback(() => {
    refreshList();
    setMode('list');
  }, [refreshList]);

  const openItem = useCallback(
    (id: string) => {
      fetchMorningById(id)
        .then((b) => {
          if (!alive.current) return;
          attach(b);
          setCameFromList(true);
          setMode('detail');
        })
        .catch(() => {});
    },
    [attach],
  );

  const backFromDetail = useCallback(() => {
    if (cameFromList) setMode('list');
    else router.back();
  }, [cameFromList]);

  const removeItem = useCallback(
    (item: MorningListItem) => {
      setList((cur) => cur.filter((x) => x.id !== item.id)); // 낙관적 제거
      deleteMorning(item.id).catch(() => refreshList()); // 실패하면 되돌린다
    },
    [refreshList],
  );

  // 넛지의 판단은 떠오르기와 같은 두 버튼이다 — 새 개념을 만들지 않는다 (§4-A3).
  const answerNudge = useCallback(
    async (response: 'acted' | 'dismissed') => {
      const fr = nudgeFrag;
      const utteranceId = brief?.nudge?.utteranceId;
      if (!fr) return;
      setNudgeFrag(null);
      setBrief((cur) => (cur ? { ...cur, nudge: null } : cur));
      if (response === 'acted') await rememberFragment(fr);
      else await letGoFragment(fr.id); // 지우지 않는다. 계속 흐려지게 둘 뿐이다.
      if (utteranceId) await recordUtteranceResponse(utteranceId, response);
    },
    [nudgeFrag, brief],
  );

  // 넛지에서 한 발 더 (§4-A3 → §4-D1). 안 건드린 이유가 **리서치를 안 해서**일 수 있으니
  // 판단을 재촉하는 대신 재료를 대신 구해온다. 칩을 누르는 것이 D1의 승인이다.
  //
  // 여기서 검색하지 않는다 — 바깥으로 나가는 길은 이미 채팅에 있다(`mode=more_like`).
  // 그 모드라야 소재의 **이름**이 아니라 **종류**로 검색어를 뽑는다. 이름으로 가면
  // 같은 물건 파는 쇼핑몰·미러 사이트만 돌아온다(chat/index.ts MORE_LIKE_SYS의 실측 실패).
  //
  // 원장엔 안 적는다. 이건 넛지에 대한 **답이 아니라** 답하기 위한 우회라서, 갔다 와도
  // 카드는 그대로 남고 판단은 여전히 흘려보내기/기억하기 둘 중 하나로 한다.
  //
  // 파편은 fid로 물려 보낸다 — 서버가 종류를 뽑는 재료는 이 문장이 아니라 파편 원본(설명·덧붙임)이다.
  // 문장은 입력창에 채워만 둔다(전송 안 함). 칩을 누르는 것이 D1의 승인이고, 보내기가 확인이다.
  const researchNudge = useCallback(() => {
    const fr = nudgeFrag;
    if (!fr) return;
    const raw = (fr.link_title || fr.content || '').replace(/\s+/g, ' ').trim();
    const subject = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
    router.push(
      `/chat?fid=${fr.id}&mode=more_like&draft=${encodeURIComponent(
        `『${subject}』 — 저장해두고 계속 안 건드렸어. 할지 말지 정하게 바깥에서 후보를 찾아서 추려줘.`,
      )}`,
    );
  }, [nudgeFrag]);

  // 성찰 질문. 답하면 자기 진술로 쌓이고(§4-B2), 넘기면 그냥 사라진다 — 재촉하지 않는다(§4-F3).
  const sendAnswer = useCallback(async () => {
    const q = brief?.question;
    const text = answer.trim();
    if (!q?.utteranceId || !text) return;
    setAnswer('');
    setBrief((cur) => (cur ? { ...cur, question: null } : cur));
    await answerQuestion(q.utteranceId, brief?.pattern?.items.map((it) => it.id) ?? [], text);
  }, [brief, answer]);

  const skipQuestion = useCallback(async () => {
    const id = brief?.question?.utteranceId;
    setBrief((cur) => (cur ? { ...cur, question: null } : cur));
    if (id) await recordUtteranceResponse(id, 'dismissed');
  }, [brief]);

  const s = brief?.stats;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        {mode === 'list' ? (
          <Pressable onPress={() => setMode('detail')} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 뒤로</Text>
          </Pressable>
        ) : (
          <Pressable onPress={backFromDetail} hitSlop={12}>
            <Text style={styles.headerBtn}>{cameFromList ? '‹ 목록' : '‹ 뒤로'}</Text>
          </Pressable>
        )}
        <Text style={styles.wordmark}>아침</Text>
        {mode === 'detail' ? (
          <Pressable onPress={openList} hitSlop={12}>
            <Text style={styles.headerBtn}>지난 기록</Text>
          </Pressable>
        ) : (
          <View style={styles.headerPad} />
        )}
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
        {mode === 'list' && (
          <>
            {list.length === 0 && <Text style={styles.empty}>아직 기록이 없다.</Text>}
            {list.map((item) => (
              <Pressable key={item.id} style={styles.histRow} onPress={() => openItem(item.id)}>
                <View style={styles.flex}>
                  <View style={styles.histMeta}>
                    <Text style={styles.histDate}>
                      {feedDateLabel(item.createdAt)} · {formatTime(item.createdAt)}
                    </Text>
                    <Text style={styles.histCost}>{formatCost(item.costUsd)}</Text>
                  </View>
                  <Text style={styles.histSnip} numberOfLines={1}>
                    {item.headline || '(제목 없음)'}
                  </Text>
                </View>
                <Pressable onPress={() => removeItem(item)} hitSlop={10} style={styles.histDel}>
                  <Text style={styles.histDelText}>지우기</Text>
                </Pressable>
              </Pressable>
            ))}
          </>
        )}

        {mode === 'detail' && !brief && <Text style={styles.empty}>오늘 아침은 아직 없다.</Text>}

        {mode === 'detail' && brief && s && (
          <>
            <Animated.View entering={FadeInDown.duration(420)} style={styles.headlineBlock}>
              <Text style={styles.date}>{feedDateLabel(brief.createdAt)}요일</Text>
              <Text style={styles.headline}>{brief.headline}</Text>
            </Animated.View>

            {/* ── 읽기 ── */}
            {brief.reading.length > 0 && (
              <Animated.View entering={FadeInDown.duration(420).delay(80)} style={styles.card}>
                {brief.reading.map((para, i) => (
                  <Text key={i} style={styles.reading}>
                    {para}
                  </Text>
                ))}
              </Animated.View>
            )}

            {/* ── 패턴 하나. 근거를 같이 보여주는 게 이 카드의 전부다 —
                 두 개로 본 건지 여덟 개로 본 건지 안 보이면 억지인지 알 수가 없다. ── */}
            {brief.pattern && (
              <Animated.View entering={FadeInDown.duration(420).delay(110)} style={styles.patternCard}>
                <Eyebrow right={`근거 ${brief.pattern.items.length}개`}>{brief.pattern.kind}</Eyebrow>
                <Text style={styles.reading}>{brief.pattern.text}</Text>
                {brief.pattern.items.map((it) => (
                  <Pressable key={it.id} onPress={() => router.push(`/fragment/${it.id}`)}>
                    <ItemLine title={it.title} vividness={it.vividness} projects={it.projects} />
                  </Pressable>
                ))}
              </Animated.View>
            )}

            {/* ── 관심의 결이 어디로 옮겨갔나. 위 문단의 그림판이다 ── */}
            {s.axes.length > 0 && (
              <Animated.View entering={FadeInDown.duration(420).delay(140)} style={styles.card}>
                <Eyebrow right="최근 7일 vs 앞 3주">관심의 결</Eyebrow>
                <AxisShift axes={s.axes} />
              </Animated.View>
            )}

            {/* ── 오늘 물어볼 것 (§4-A3 넛지) ── */}
            {brief.nudge && nudgeFrag && (
              <View style={styles.nudgeCard}>
                <Eyebrow>오늘 물어볼 것</Eyebrow>
                <Pressable onPress={() => router.push(`/fragment/${nudgeFrag.id}`)}>
                  <Text style={styles.nudgeBody} numberOfLines={4}>
                    {nudgeFrag.link_title || nudgeFrag.content}
                  </Text>
                </Pressable>
                <Text style={styles.nudgeQuestion}>{brief.nudge.question}</Text>
                <View style={styles.actions}>
                  {/* link 타입에만 건다 — 실측(2026-08-03): 넛지 후보 50개 중 88%가 text
                      (에세이·개발 메모·생각 조각)라 "바깥에서 후보 찾아줄까"가 말이 안 됐다.
                      link만 "이거 같은 종류로 또 뭐 있나"가 자연스러운 질문이 된다.
                      판단(흘려보내기·기억하기)과 다른 종류의 행동이라 반대쪽에 둔다. */}
                  {nudgeFrag.type === 'link' && (
                    <Pressable onPress={researchNudge} hitSlop={8} style={styles.nudgeAsk}>
                      <Text style={styles.nudgeAskLabel}>후보 찾아줄까</Text>
                    </Pressable>
                  )}
                  <View style={styles.spacer} />
                  <Pressable onPress={() => answerNudge('dismissed')} hitSlop={8}>
                    <Text style={styles.letGo}>흘려보내기</Text>
                  </Pressable>
                  <Pressable onPress={() => answerNudge('acted')} hitSlop={8} style={styles.rememberBtn}>
                    <Text style={styles.remember}>기억하기</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* ── 어제/오늘 던진 것 ── */}
            {(s.yesterday.length > 0 || s.today.length > 0) && (
              <View style={styles.card}>
                <Eyebrow right={`${s.yesterday.length + s.today.length}개`}>던진 것</Eyebrow>
                {s.today.length > 0 && <Text style={styles.subLabel}>오늘</Text>}
                {s.today.map((it) => (
                  <Pressable key={it.id} onPress={() => router.push(`/fragment/${it.id}`)}>
                    <ItemLine title={it.title} projects={it.projects} />
                  </Pressable>
                ))}
                {s.yesterday.length > 0 && <Text style={styles.subLabel}>어제</Text>}
                {s.yesterday.map((it) => (
                  <Pressable key={it.id} onPress={() => router.push(`/fragment/${it.id}`)}>
                    <ItemLine title={it.title} projects={it.projects} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* ── 지금 서 있는 축 ── */}
            {s.axes.length > 0 && (
              <View style={styles.card}>
                <Eyebrow right="최근 30일">서 있는 축</Eyebrow>
                {s.axes.map((a) => (
                  <View key={a.label} style={styles.axisBlock}>
                    <View style={styles.axisHead}>
                      <Text style={styles.axisLabel}>{a.label}</Text>
                      <View style={styles.kindTag}>
                        <Text style={styles.kindText}>{a.kind}</Text>
                      </View>
                      <Text style={styles.axisMeta}>
                        {a.count}개
                        {a.quietDays >= 7 ? ` · ${a.quietDays}일째 조용` : ''}
                      </Text>
                    </View>
                    <AxisTimeline marks={a.marks} />
                    {a.items.slice(0, 3).map((it) => (
                      <Pressable key={it.id} onPress={() => router.push(`/fragment/${it.id}`)}>
                        <ItemLine title={it.title} vividness={it.vividness} />
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {/* ── 선명도 지형 ── */}
            <View style={styles.card}>
              <Eyebrow right={`살아있는 ${s.totals.alive}개`}>선명도 지형</Eyebrow>
              <BandBar bands={s.bands} />
            </View>

            {/* ── 저장 리듬 ── */}
            <View style={styles.card}>
              <Eyebrow right="최근 14일">던진 리듬</Eyebrow>
              <RhythmBars rhythm={s.rhythm} />
            </View>

            {/* ── 흐려지는 중 — 아직 바닥은 아닌 것들 ── */}
            {s.fading.length > 0 && (
              <View style={styles.card}>
                <Eyebrow right={`${s.totals.fading}개 중`}>흐려지는 중</Eyebrow>
                {s.fading.map((it) => (
                  <Pressable key={it.id} onPress={() => router.push(`/fragment/${it.id}`)}>
                    <ItemLine title={it.title} vividness={it.vividness} projects={it.projects} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* ── 조용한 프로젝트 ── */}
            {s.quietProjects.length > 0 && (
              <View style={styles.card}>
                <Eyebrow>조용한 프로젝트</Eyebrow>
                {s.quietProjects.map((p) => (
                  <QuietRow key={p.name} name={p.name} days={p.days} total={p.total} />
                ))}
              </View>
            )}

            {/* ── 하루의 마지막 한 줄. 답을 요구하지 않는다 — 넘겨도 아무 일도 안 일어난다. ── */}
            {brief.question && (
              <View style={styles.questionCard}>
                <Eyebrow>오늘의 질문</Eyebrow>
                <Text style={styles.question}>{brief.question.text}</Text>
                <TextInput
                  style={styles.answerInput}
                  multiline
                  value={answer}
                  onChangeText={setAnswer}
                  placeholder="답해두면 다음부터 이걸 근거로 말한다 (선택)"
                  placeholderTextColor={colors.faint}
                  keyboardAppearance="dark"
                />
                <View style={styles.actions}>
                  <View style={styles.spacer} />
                  <Pressable onPress={skipQuestion} hitSlop={8}>
                    <Text style={styles.letGo}>넘기기</Text>
                  </Pressable>
                  <Pressable
                    onPress={sendAnswer}
                    disabled={!answer.trim()}
                    hitSlop={8}
                    style={[styles.rememberBtn, !answer.trim() && styles.rememberBtnOff]}
                  >
                    <Text style={styles.remember}>남기기</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* ── 보이는 거절 (RUDY-DISCOVERY §6 — 유저가 명시적으로 좋아하는 자리) ── */}
            {brief.rejected.length > 0 && (
              <View style={styles.rejectCard}>
                <Eyebrow>안 쓴 것</Eyebrow>
                {brief.rejected.map((r, i) => (
                  <Text key={`${r}-${i}`} style={styles.rejectText}>
                    {r}
                  </Text>
                ))}
              </View>
            )}

            {brief.costUsd != null && (
              <Text style={styles.cost}>${brief.costUsd.toFixed(3)}</Text>
            )}
          </>
        )}
      </ScrollView>
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
  wordmark: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 2 },
  headerBtn: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  // 뒤로 버튼과 균형을 맞추는 빈 자리 — 만들기 버튼이 있던 곳이다(이제 앱은 만들지 않는다)
  headerPad: { minWidth: 44 },
  list: { padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.md },

  empty: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans, marginTop: spacing.xl },

  // 지난 기록 목록 — discovery.tsx의 histRow와 같은 결
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  histMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs },
  histDate: { ...type.bodySm, color: colors.mute, fontFamily: fonts.mono },
  histCost: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono, marginLeft: spacing.xxs },
  histSnip: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium },
  histDel: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs },
  histDelText: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans },

  headlineBlock: { gap: spacing.xs, marginTop: spacing.xs, marginBottom: spacing.xs },
  date: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },
  // 헤드라인은 카드 밖에 둔다 — 이게 오늘의 주장이고, 나머지는 그 근거다
  headline: { ...type.headingMd, color: colors.ink, fontFamily: fonts.sansSemiBold },

  card: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    padding: spacing.card,
    gap: spacing.sm,
  },
  // 읽기 문단 — 파편 목록이 아니라 글이라 본문 크기로 쓴다
  reading: { ...type.bodyLg, color: colors.body, fontFamily: fonts.sans },
  subLabel: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono, marginTop: spacing.xxs },

  axisBlock: { gap: spacing.xs, paddingTop: spacing.xs },
  axisHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  axisLabel: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium },
  kindTag: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  kindText: { ...type.bodySm, color: colors.mute, fontFamily: fonts.mono },
  axisMeta: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono, marginLeft: 'auto' },

  // 패턴은 이 브리핑의 알맹이라 읽기 카드 바로 뒤에서 한 단계 도드라지게 둔다
  patternCard: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.mute,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    padding: spacing.card,
    gap: spacing.sm,
  },

  // 넛지·질문은 판단을 요구하는 카드라 테두리를 한 단계 올려 구분한다
  nudgeCard: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.mute,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    padding: spacing.card,
    gap: spacing.sm,
  },
  nudgeBody: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sans },
  nudgeQuestion: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  // 파편 상세의 원탭 칩과 같은 결 — 둘 다 "루디에게 넘기는 문"이라 모양을 맞춘다
  nudgeAsk: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  nudgeAskLabel: { ...type.bodySm, color: colors.body, fontFamily: fonts.sans },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  spacer: { flex: 1 },
  letGo: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  rememberBtn: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 100,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
  remember: { ...type.bodySm, color: colors.ink, fontFamily: fonts.sansMedium },
  rememberBtnOff: { opacity: 0.4 },

  questionCard: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.mute,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    padding: spacing.card,
    gap: spacing.sm,
  },
  question: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sans },
  answerInput: {
    ...type.bodyMd,
    color: colors.body,
    fontFamily: fonts.sans,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.sm,
    padding: spacing.sm,
    minHeight: 60,
    textAlignVertical: 'top',
  },

  rejectCard: { gap: spacing.xs, paddingHorizontal: spacing.xxs },
  rejectText: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  cost: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono, textAlign: 'right' },
});
