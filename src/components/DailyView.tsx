import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { FragmentBullet } from '@/components/FragmentBullet';
import { SwipeableRow } from '@/components/SwipeableRow';
import { confirmDelete } from '@/lib/confirm';
import { addDays, dayKey, feedDateLabel, startOfWeek, WEEKDAY_LABELS } from '@/lib/dates';
import { deleteFragment, fetchFragmentsByRange } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import { consumeThrown } from '@/lib/thrown';
import type { Fragment } from '@/lib/types';
import { opacity } from '@/lib/vividness';

// 표시 가능한 과거 범위: 26주 (반년). 더 옛날은 피드/검색으로.
const WEEKS_BACK = 26;
const MAX_DOTS = 12;

// 화면 6.1 — 데일리 뷰. 주간 스트립의 점 투명도 = 그 파편의 현재 선명도.
// 캘린더 스트립 자체가 기억의 지도가 된다.
export function DailyView() {
  const { width } = useWindowDimensions();
  const today = useMemo(() => new Date(), []);
  const weeks = useMemo(() => {
    const cur = startOfWeek(today);
    return Array.from({ length: WEEKS_BACK + 1 }, (_, i) => addDays(cur, -7 * (WEEKS_BACK - i)));
  }, [today]);

  const [selected, setSelected] = useState<Date>(today);
  const [weekIdx, setWeekIdx] = useState(WEEKS_BACK);
  const [byWeek, setByWeek] = useState<Record<string, Fragment[]>>({});
  const stripRef = useRef<FlatList>(null);

  const loadWeek = useCallback(async (weekStart: Date) => {
    try {
      const frs = await fetchFragmentsByRange(
        weekStart.toISOString(),
        addDays(weekStart, 7).toISOString(),
      );
      setByWeek((prev) => ({ ...prev, [weekStart.toISOString()]: frs }));
    } catch {
      // 조회 실패 시 해당 주는 빈 채로 — 재진입 시 재시도
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // 던진 직후에는 오늘로 이동 (PLAN §6.1)
      if (consumeThrown()) {
        setSelected(new Date());
        setWeekIdx(WEEKS_BACK);
        stripRef.current?.scrollToIndex({ index: WEEKS_BACK, animated: false });
      }
      loadWeek(weeks[weekIdx]);
    }, [weekIdx, loadWeek, weeks]),
  );

  const weekFragments = byWeek[weeks[weekIdx].toISOString()] ?? [];
  const now = new Date();
  const selectedKey = dayKey(selected.toISOString());
  const dayFragments = weekFragments.filter((fr) => dayKey(fr.created_at) === selectedKey);
  const todayKey = dayKey(today.toISOString());

  async function removeFragment(fr: Fragment) {
    if (!(await confirmDelete())) return;
    await deleteFragment(fr);
    loadWeek(weeks[weekIdx]);
  }

  function renderWeek({ item: weekStart }: { item: Date }) {
    const frs = byWeek[weekStart.toISOString()] ?? [];
    return (
      <View style={[styles.weekRow, { width }]}>
        {Array.from({ length: 7 }, (_, i) => {
          const day = addDays(weekStart, i);
          const key = dayKey(day.toISOString());
          const isFuture = day.getTime() > today.getTime();
          const dayFrs = frs.filter((fr) => dayKey(fr.created_at) === key);
          return (
            <Pressable
              key={key}
              style={[styles.dayCell, key === selectedKey && styles.dayCellSelected]}
              onPress={() => !isFuture && setSelected(day)}
            >
              <Text style={styles.weekdayLabel}>{WEEKDAY_LABELS[day.getDay()]}</Text>
              <Text
                style={[
                  styles.dayNum,
                  key === todayKey && styles.dayNumToday,
                  isFuture && styles.dayNumFuture,
                ]}
              >
                {day.getDate()}
              </Text>
              <View style={styles.dots}>
                {dayFrs.slice(0, MAX_DOTS).map((fr) => (
                  <View
                    key={fr.id}
                    style={[
                      styles.dot,
                      { opacity: opacity(new Date(fr.last_touched_at), fr.tier, now) },
                    ]}
                  />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={stripRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={weeks}
        keyExtractor={(d) => d.toISOString()}
        renderItem={renderWeek}
        initialScrollIndex={WEEKS_BACK}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / width);
          if (idx !== weekIdx && idx >= 0 && idx <= WEEKS_BACK) {
            setWeekIdx(idx);
            // 주가 바뀌면 같은 요일을 선택 유지
            const next = addDays(weeks[idx], selected.getDay());
            setSelected(next.getTime() > today.getTime() ? today : next);
          }
        }}
        style={styles.strip}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  strip: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  weekRow: { flexDirection: 'row', paddingVertical: spacing.sm },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
    marginHorizontal: 2,
    borderRadius: rounded.sm,
  },
  dayCellSelected: { backgroundColor: colors.hairlineSoft },
  weekdayLabel: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  dayNum: { ...type.labelSm, color: colors.ink, fontFamily: fonts.sansMedium },
  dayNumToday: { color: colors.link },
  dayNumFuture: { color: colors.faint },
  dots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 3,
    width: 30,
    minHeight: 18,
  },
  dot: { width: 4.5, height: 4.5, borderRadius: 2.5, backgroundColor: colors.ink },
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
