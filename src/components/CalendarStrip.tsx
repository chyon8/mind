import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  addDays,
  addMonths,
  dayKey,
  monthWeekStarts,
  startOfMonth,
  startOfWeek,
  WEEKDAY_LABELS,
} from '@/lib/dates';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { opacity } from '@/lib/vividness';

// 스트립을 아래로 끌면 펼쳐진다: 주 → 2주 → 월. 리스트는 덮이지 않고 아래로 밀린다.
export type StripMode = 'week' | 'biweek' | 'month';

const MODES: StripMode[] = ['week', 'biweek', 'month'];
const ROWS: Record<StripMode, number> = { week: 1, biweek: 2, month: 6 };

const WEEKS_BACK = 26; // 과거 26주 (반년). 더 옛날은 피드/검색으로 (PLAN §6.1)
const MONTHS_BACK = 6;
const MAX_DOTS = 12;

const ROW_H = 46;
const HEADER_H = 18;
const CHROME = spacing.sm * 2 + 14; // 상하 여백 + 손잡이

function heightFor(mode: StripMode): number {
  return HEADER_H + ROWS[mode] * ROW_H + CHROME;
}

const SNAPS = MODES.map(heightFor);

// 페이지 = 가로 스와이프 한 칸. 모드마다 단위가 다르다: 1주 / 2주 / 1달
function pagesFor(mode: StripMode, today: Date): Date[] {
  if (mode === 'month') {
    return Array.from({ length: MONTHS_BACK + 1 }, (_, i) =>
      addMonths(today, -(MONTHS_BACK - i)),
    );
  }
  const cur = startOfWeek(today);
  if (mode === 'biweek') {
    // 마지막 페이지가 [지난 주, 이번 주]가 되도록 홀수 주에서 끊는다
    const n = WEEKS_BACK / 2;
    return Array.from({ length: n }, (_, i) => addDays(cur, -7 * (2 * (n - 1 - i) + 1)));
  }
  return Array.from({ length: WEEKS_BACK + 1 }, (_, i) => addDays(cur, -7 * (WEEKS_BACK - i)));
}

// 그 페이지가 그리는 주(행)들의 시작일
function weekStartsIn(mode: StripMode, page: Date): Date[] {
  if (mode === 'month') return monthWeekStarts(page);
  if (mode === 'biweek') return [page, addDays(page, 7)];
  return [page];
}

function pageHolds(mode: StripMode, page: Date, d: Date): boolean {
  if (mode === 'month') {
    return d.getFullYear() === page.getFullYear() && d.getMonth() === page.getMonth();
  }
  const span = mode === 'biweek' ? 14 : 7;
  return d >= page && d < addDays(page, span);
}

export function CalendarStrip({
  selected,
  today,
  byDay,
  onSelect,
  onRangeNeeded,
}: {
  selected: Date;
  today: Date;
  byDay: Record<string, Fragment[]>;
  onSelect: (d: Date) => void;
  onRangeNeeded: (from: Date, to: Date) => void;
}) {
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<StripMode>('week');

  const height = useSharedValue(heightFor('week'));
  const dragStart = useSharedValue(0);

  const pages = useMemo(() => pagesFor(mode, today), [mode, today]);
  // 모드가 바뀌면 선택된 날이 들어 있는 페이지에서 다시 시작한다
  const initialPage = Math.max(
    0,
    pages.findIndex((p) => pageHolds(mode, p, selected)),
  );

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-16, 16]) // 가로 스와이프는 FlatList에 양보한다
    .onBegin(() => {
      dragStart.value = height.value;
    })
    .onUpdate((e) => {
      const next = dragStart.value + e.translationY;
      height.value = Math.min(Math.max(next, SNAPS[0]), SNAPS[SNAPS.length - 1]);
    })
    .onEnd(() => {
      const nearest = SNAPS.reduce((a, b) =>
        Math.abs(b - height.value) < Math.abs(a - height.value) ? b : a,
      );
      height.value = withTiming(nearest, { duration: 180 });
    });

  // 끌고 있는 도중에도 중간 지점을 넘으면 격자가 바로 바뀐다 — 손을 뗄 때까지 기다리지 않는다
  useAnimatedReaction(
    () => {
      let nearest = 0;
      for (let i = 1; i < SNAPS.length; i++) {
        if (Math.abs(SNAPS[i] - height.value) < Math.abs(SNAPS[nearest] - height.value)) nearest = i;
      }
      return nearest;
    },
    (next, prev) => {
      if (prev !== null && next !== prev) runOnJS(setMode)(MODES[next]);
    },
  );

  const animatedStyle = useAnimatedStyle(() => ({ height: height.value }));

  function renderPage({ item: page }: { item: Date }) {
    return (
      <View style={{ width }}>
        {weekStartsIn(mode, page).map((weekStart) => (
          <View key={weekStart.toISOString()} style={styles.weekRow}>
            {Array.from({ length: 7 }, (_, i) => {
              const day = addDays(weekStart, i);
              const key = dayKey(day.toISOString());
              const frs = byDay[key] ?? [];
              const isFuture = day > today;
              const isSelected = key === dayKey(selected.toISOString());
              const isToday = key === dayKey(today.toISOString());
              // 월 그리드에는 이웃 달 날짜가 딸려 들어온다 — 있되 물러나 있게
              const isOutside =
                mode === 'month' && day.getMonth() !== startOfMonth(page).getMonth();
              return (
                <Pressable
                  key={key}
                  style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                  onPress={() => !isFuture && onSelect(day)}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      isToday && styles.dayNumToday,
                      (isFuture || isOutside) && styles.dayNumFaint,
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                  <View style={styles.marks}>
                    {mode === 'month' ? (
                      <DensityMark fragments={frs} today={today} />
                    ) : (
                      frs.slice(0, MAX_DOTS).map((fr) => (
                        <View
                          key={fr.id}
                          style={[
                            styles.dot,
                            { opacity: opacity(new Date(fr.last_touched_at), fr.tier, today) },
                          ]}
                        />
                      ))
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.strip, animatedStyle]}>
        <View style={styles.weekdayHeader}>
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} style={styles.weekdayLabel}>
              {label}
            </Text>
          ))}
        </View>

        <FlatList
          key={mode} // 모드가 바뀌면 페이지 단위가 통째로 달라진다
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          data={pages}
          keyExtractor={(d) => d.toISOString()}
          renderItem={renderPage}
          initialScrollIndex={initialPage}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / width);
            const page = pages[idx];
            if (!page) return;
            const weeks = weekStartsIn(mode, page);
            onRangeNeeded(weeks[0], addDays(weeks[weeks.length - 1], 7));
          }}
        />

        <View style={styles.handle} />
      </Animated.View>
    </GestureDetector>
  );
}

// 월 뷰엔 점 12개가 안 들어간다 — 하나로 접되 개수는 크기로, 기억은 투명도로 남긴다.
// 하루 중 가장 또렷한 파편을 쓴다: 하나만 다시 열어봐도 그 날은 되살아난다.
function DensityMark({ fragments, today }: { fragments: Fragment[]; today: Date }) {
  if (fragments.length === 0) return null;
  const size = fragments.length >= 6 ? 8 : fragments.length >= 3 ? 6 : 4;
  const vivid = Math.max(
    ...fragments.map((fr) => opacity(new Date(fr.last_touched_at), fr.tier, today)),
  );
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.ink,
        opacity: vivid,
      }}
    />
  );
}

const styles = StyleSheet.create({
  strip: {
    overflow: 'hidden', // 끄는 도중 넘치는 행을 잘라낸다
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  weekdayHeader: { flexDirection: 'row', height: HEADER_H },
  weekdayLabel: {
    ...type.bodySm,
    flex: 1,
    textAlign: 'center',
    color: colors.mute,
    fontFamily: fonts.sans,
  },
  weekRow: { flexDirection: 'row', height: ROW_H },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
    marginHorizontal: 2,
    borderRadius: rounded.sm,
  },
  dayCellSelected: { backgroundColor: colors.hairlineSoft },
  dayNum: { ...type.labelSm, color: colors.ink, fontFamily: fonts.sansMedium },
  dayNumToday: { color: colors.link },
  dayNumFaint: { color: colors.faint },
  marks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
    width: 30,
    minHeight: 16,
  },
  dot: { width: 4.5, height: 4.5, borderRadius: 2.5, backgroundColor: colors.ink },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    alignSelf: 'center',
    marginTop: spacing.xs,
  },
});
