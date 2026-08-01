import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AxisShift,
  AxisTimeline,
  BandBar,
  Eyebrow,
  ItemLine,
  MorningSkeleton,
  QuietRow,
  RhythmBars,
} from '@/components/MorningViz';
import { feedDateLabel } from '@/lib/dates';
import {
  fetchTodayMorning,
  generateMorning,
  type MorningBrief,
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
// 화면의 순서 = 읽는 순서다. **주장 먼저, 근거는 그 다음.** 숫자를 먼저 보여주면
// 대시보드가 되고, 대시보드는 유저가 스스로 해석해야 하는 숙제를 남긴다(§4-F5의 "서사" 요구).
export default function MorningScreen() {
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [nudgeFrag, setNudgeFrag] = useState<Fragment | null>(null);
  const [gen, setGen] = useState(false);
  const [error, setError] = useState('');
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

  const run = useCallback(() => {
    if (gen) return;
    setGen(true);
    setError('');
    generateMorning()
      .then((b) => alive.current && attach(b))
      .catch((e) => alive.current && setError(String(e?.message ?? e)))
      .finally(() => alive.current && setGen(false));
  }, [gen, attach]);

  // 넛지의 판단은 떠오르기와 같은 두 버튼이다 — 새 개념을 만들지 않는다 (§4-A3).
  const answer = useCallback(
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

  const s = brief?.stats;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBtn}>‹ 뒤로</Text>
        </Pressable>
        <Text style={styles.wordmark}>아침</Text>
        <Pressable onPress={run} disabled={gen} hitSlop={12}>
          <Text style={[styles.headerBtn, gen && styles.headerBtnOff]}>
            {gen ? '읽는 중' : brief ? '다시' : '만들기'}
          </Text>
        </Pressable>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
        {!brief && !gen && (
          <Text style={styles.empty}>
            {error || '아직 오늘 아침을 안 읽었다. 오른쪽 위 만들기.'}
          </Text>
        )}
        {gen && !brief && <MorningSkeleton />}
        {!!error && brief && <Text style={styles.error}>{error}</Text>}

        {brief && s && (
          <>
            <Animated.View entering={FadeInDown.duration(420)} style={styles.headlineBlock}>
              <Text style={styles.date}>{feedDateLabel(brief.createdAt)}요일</Text>
              <Text style={styles.headline}>{brief.headline}</Text>
            </Animated.View>

            {/* ── 읽기. 집계만 말한다 — 개별 파편을 인용하지 않는다 (morning/prompt.ts 3차 참고) ── */}
            {brief.reading.length > 0 && (
              <Animated.View entering={FadeInDown.duration(420).delay(80)} style={styles.card}>
                {brief.reading.map((para, i) => (
                  <Text key={i} style={styles.reading}>
                    {para}
                  </Text>
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
                  <View style={styles.spacer} />
                  <Pressable onPress={() => answer('dismissed')} hitSlop={8}>
                    <Text style={styles.letGo}>흘려보내기</Text>
                  </Pressable>
                  <Pressable onPress={() => answer('acted')} hitSlop={8} style={styles.rememberBtn}>
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
  headerBtnOff: { color: colors.faint },
  list: { padding: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.md },

  empty: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans, marginTop: spacing.xl },
  error: { ...type.bodySm, color: colors.error, fontFamily: fonts.sans },

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

  // 넛지는 판단을 요구하는 유일한 카드라 테두리를 한 단계 올려 구분한다
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

  rejectCard: { gap: spacing.xs, paddingHorizontal: spacing.xxs },
  rejectText: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  cost: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono, textAlign: 'right' },
});
