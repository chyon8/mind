import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarStrip } from '@/components/CalendarStrip';
import { FragmentBullet } from '@/components/FragmentBullet';
import { SwipeableRow } from '@/components/SwipeableRow';
import { TodayPill } from '@/components/TodayPill';
import { confirmDelete } from '@/lib/confirm';
import { addDays, dayKey, feedDateLabel, startOfWeek } from '@/lib/dates';
import { deleteFragment, fetchFragmentsByRange } from '@/lib/supabase';
import { colors, fonts, spacing, type } from '@/lib/theme';
import { consumeThrown, onThrown } from '@/lib/thrown';
import type { Fragment } from '@/lib/types';
import { opacity } from '@/lib/vividness';

// 화면 6.1 — 데일리 뷰. 주간 스트립의 점 투명도 = 그 파편의 현재 선명도.
// 캘린더 스트립 자체가 기억의 지도가 된다.
export function DailyView() {
  const today = useMemo(() => new Date(), []);
  const [selected, setSelected] = useState<Date>(today);
  const [anchor, setAnchor] = useState<Date>(today); // 스트립이 넘겨보고 있는 위치
  const [away, setAway] = useState(false); // 스트립이 오늘을 벗어났나
  // 스트립이 월까지 펼쳐지면 6주치가 한 번에 필요하다 — 캐시 단위는 주가 아니라 날.
  const [byDay, setByDay] = useState<Record<string, Fragment[]>>({});
  const range = useRef<[Date, Date]>([startOfWeek(today), addDays(startOfWeek(today), 7)]);

  const loadRange = useCallback(async (from: Date, to: Date) => {
    range.current = [from, to];
    try {
      const frs = await fetchFragmentsByRange(from.toISOString(), to.toISOString());
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
      // 조회 실패 시 해당 범위는 빈 채로 — 재진입 시 재시도
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

  const now = new Date();
  const dayFragments = byDay[dayKey(selected.toISOString())] ?? [];

  async function removeFragment(fr: Fragment) {
    if (!(await confirmDelete())) return;
    await deleteFragment(fr);
    loadRange(...range.current);
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

      {dayFragments.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>이 날은 아무것도 던지지 않았다</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {dayFragments.map((fr) => (
            <SwipeableRow
              key={fr.id}
              onEdit={() => router.push({ pathname: '/input', params: { id: fr.id } })}
              onDelete={() => removeFragment(fr)}
            >
              <Pressable onPress={() => router.push(`/fragment/${fr.id}`)}>
                <FragmentBullet
                  fragment={fr}
                  rowOpacity={opacity(new Date(fr.last_touched_at), fr.tier, now)}
                />
              </Pressable>
            </SwipeableRow>
          ))}
        </ScrollView>
      )}

      {/* 다른 날을 보고 있거나, 스트립이 오늘이 없는 주/달을 넘겨보고 있을 때 */}
      <TodayPill
        visible={away || dayKey(selected.toISOString()) !== dayKey(today.toISOString())}
        onPress={jumpToToday}
      />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
});
