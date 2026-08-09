import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarStrip } from '@/components/CalendarStrip';
import { FragmentBullet } from '@/components/FragmentBullet';
import { MorningCard } from '@/components/MorningCard';
import { RecallSection } from '@/components/RecallSection';
import { SelectionBar } from '@/components/SelectionBar';
import { SwipeableRow } from '@/components/SwipeableRow';
import { TodayPill } from '@/components/TodayPill';
import { confirmDelete } from '@/lib/confirm';
import { addDays, dayKey, feedDateLabel, startOfWeek, getTimeBand } from '@/lib/dates';
import { deleteFragment, fetchFragmentsByRange, mergeFragments } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import { consumeThrown, onThrown } from '@/lib/thrown';
import { onFragmentUpdated } from '@/lib/fragmentUpdates';
import { useMergeSelection } from '@/lib/useMergeSelection';
import type { Fragment } from '@/lib/types';
import { vividness } from '@/lib/vividness';

// 화면 6.1 — 데일리 뷰. 주간 스트립의 점 투명도 = 그 파편의 현재 선명도.
// 캘린더 스트립 자체가 기억의 지도가 된다.
export function DailyView() {
  // 자정을 넘겨 앱을 켜둔 채로 두면 "오늘"이 어제로 고정돼 진짜 오늘 셀이 미래로 막힌다 —
  // 포그라운드로 돌아올 때마다 다시 잰다 (MorningCard·RecallSection과 같은 패턴).
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setToday(new Date());
    });
    return () => sub.remove();
  }, []);
  const [selected, setSelected] = useState<Date>(today);
  const [anchor, setAnchor] = useState<Date>(today); // 스트립이 넘겨보고 있는 위치
  const [away, setAway] = useState(false); // 스트립이 오늘을 벗어났나
  // 스트립이 월까지 펼쳐지면 6주치가 한 번에 필요하다 — 캐시 단위는 주가 아니라 날.
  const [byDay, setByDay] = useState<Record<string, Fragment[]>>({});
  const range = useRef<[Date, Date]>([startOfWeek(today), addDays(startOfWeek(today), 7)]);
  const loadVersion = useRef(0);
  // 마운트 때 스트립(onRangeNeeded)과 포커스가 같은 주를 동시에 청한다 — 나가는 요청은 둘,
  // 쓰는 응답은 하나였다. 같은 범위가 이미 날아가 있으면 두 번 보내지 않는다.
  const inflight = useRef<string | null>(null);
  const selection = useMergeSelection();

  const loadRange = useCallback(async (from: Date, to: Date) => {
    const sig = `${from.toISOString()}|${to.toISOString()}`;
    if (inflight.current === sig) return;
    inflight.current = sig;
    range.current = [from, to];
    const version = ++loadVersion.current;
    try {
      const frs = await fetchFragmentsByRange(from.toISOString(), to.toISOString());
      if (version !== loadVersion.current) return;
      // 범위 안의 날은 전부 새로 쓴다 — 안 그러면 삭제된 파편이 캐시에 남는다
      const fresh: Record<string, Fragment[]> = {};
      for (let d = new Date(from); d < to; d = addDays(d, 1)) {
        fresh[dayKey(d.toISOString())] = [];
      }
      for (const fr of frs) {
        const key = dayKey(fr.created_at);
        if (fresh[key]) fresh[key].push(fr);
      }
      setByDay((prev) => ({ ...prev, ...fresh }));
    } catch {
      // 조회 실패 시 해당 범위는 안 읽은 채로 — 재진입 시 재시도.
      // 빈 배열을 넣지 않는다: 그러면 "못 읽었다"가 "던진 게 없다"로 둔갑한다.
    } finally {
      if (inflight.current === sig) inflight.current = null;
    }
  }, []);

  // 던진 직후에는 오늘로 이동해서 방금 던진 게 보이게 한다 (PLAN §6.1)
  const jumpToToday = useCallback(() => {
    const now = new Date();
    setSelected(now);
    setAnchor(now);
    loadRange(startOfWeek(now), addDays(startOfWeek(now), 7));
  }, [loadRange]);

  // 날짜를 고르면 그 날이 곧 보고 있는 자리다
  const selectDay = useCallback((d: Date) => {
    setSelected(d);
    setAnchor(d);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (consumeThrown()) jumpToToday();
      else loadRange(...range.current);
    }, [loadRange, jumpToToday]),
  );

  // 공유 저장은 이 화면이 이미 떠 있는 채로 일어난다 — 포커스가 안 바뀌므로 직접 듣는다
  useEffect(
    () =>
      onThrown(() => {
        consumeThrown();
        jumpToToday();
      }),
    [jumpToToday],
  );

  // 상세에서 저장이 끝난 순간 현재 보고 있는 날짜 범위를 다시 읽는다.
  useEffect(() => onFragmentUpdated(() => loadRange(...range.current)), [loadRange]);

  const now = new Date();
  const selectedKey = dayKey(selected.toISOString());
  const dayFragments = byDay[selectedKey] ?? [];
  // loadRange가 범위 안의 모든 날에 키를 만들어 두므로, 키의 존재 자체가 "이 날은 읽었다"다.
  // 이걸 안 보면 첫 렌더에서 아직 안 읽은 오늘이 "아무것도 던지지 않았다"로 보인다.
  const dayLoaded = byDay[selectedKey] !== undefined;

  async function removeFragment(fr: Fragment) {
    if (!(await confirmDelete())) return;
    await deleteFragment(fr);
    loadRange(...range.current);
  }

  async function handleMerge() {
    const merged = await mergeFragments([...selection.selected]);
    selection.clear();
    loadRange(...range.current);
    router.push(`/fragment/${merged.id}`);
  }

  return (
    <View style={styles.container}>
      <CalendarStrip
        selected={selected}
        today={today}
        byDay={byDay}
        anchor={anchor}
        onSelect={selectDay}
        onAnchor={setAnchor}
        onRangeNeeded={loadRange}
        onAwayChange={setAway}
      />

      <Text style={styles.dateTitle}>{feedDateLabel(selected.toISOString())}요일</Text>

      <ScrollView contentContainerStyle={styles.list}>
        {/* 아침 브리핑 입구. 보고 있는 그 날짜의 브리핑이 있으면 선다. */}
        <MorningCard date={selected} />

        {!dayLoaded ? null : dayFragments.length === 0 ? ( // 읽기 전엔 아무 말도 안 한다
          <Text style={styles.emptyText}>이 날은 아무것도 던지지 않았다</Text>
        ) : (
          dayFragments.map((fr, index) => {
            const isSelected = selection.selected.has(fr.id);
            const body = <FragmentBullet fragment={fr} rowOpacity={vividness(fr, now)} />;
            const band = getTimeBand(fr.created_at);
            const prevBand = index > 0 ? getTimeBand(dayFragments[index - 1].created_at) : null;

            // 선택 모드에서는 스와이프를 끄고 탭이 곧 선택 토글이 된다 — 제스처 충돌 방지.
            // 링은 행을 딱 감싸고, 좌우 여백을 조금 줘 끝이 모서리에 물리지 않게 한다.
            const row = selection.active ? (
              <Pressable
                key={fr.id}
                onPress={() => selection.toggle(fr.id)}
                style={[styles.selRow, isSelected && styles.selOn]}
              >
                {body}
              </Pressable>
            ) : (
              <SwipeableRow
                key={fr.id}
                onEdit={() => router.push(`/fragment/${fr.id}`)}
                onDelete={() => removeFragment(fr)}
              >
                <Pressable
                  onPress={() => router.push(`/fragment/${fr.id}`)}
                  onLongPress={() => selection.toggle(fr.id)}
                >
                  {body}
                </Pressable>
              </SwipeableRow>
            );

            if (band !== prevBand) {
              return (
                <View key={`group-${fr.id}`}>
                  <View style={styles.bandDivider}>
                    <Text style={styles.bandLabel}>{band}</Text>
                    <View style={styles.bandLine} />
                  </View>
                  {row}
                </View>
              );
            }
            return row;
          })
        )}

        {/* 어떤 날짜를 보고 있어도 항상 뜬다 — 떠오름은 오늘 파편이 아니라 감쇠재고라 날짜를 안 탄다. */}
        <RecallSection visible />
      </ScrollView>

      {/* 다른 날을 보고 있거나, 스트립이 오늘이 없는 주/달을 넘겨보고 있을 때 */}
      <TodayPill
        visible={
          !selection.active &&
          (away || dayKey(selected.toISOString()) !== dayKey(today.toISOString()))
        }
        onPress={jumpToToday}
      />

      {selection.active && (
        <SelectionBar
          count={selection.selected.size}
          onMerge={handleMerge}
          onCancel={selection.clear}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  dateTitle: {
    ...type.headingMd,
    color: colors.ink,
    fontFamily: fonts.sansSemiBold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: 120 },
  selRow: {
    borderRadius: rounded.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingHorizontal: spacing.xs,
  },
  selOn: { borderColor: colors.link },
  emptyText: {
    ...type.bodyMd,
    color: colors.mute,
    fontFamily: fonts.sans,
    paddingTop: spacing.xl,
    textAlign: 'center',
  },
  bandDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  bandLabel: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sansMedium },
  bandLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairlineSoft },
});
