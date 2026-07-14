import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { DensityMark } from '@/components/CalendarStrip';
import {
  addDays,
  addMonths,
  dayKey,
  monthLabel,
  monthWeekStarts,
  startOfMonth,
  WEEKDAY_LABELS,
} from '@/lib/dates';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { DayMark } from '@/lib/types';

// 피드/어젠다에서 날짜 pill을 누르면 내려오는 월 캘린더. 헤더에 버튼을 새로 달지 않기 위한 장치다.
// 점은 전체 날짜 인덱스(fetchDayIndex)에서 오므로, 아직 스크롤로 안 읽은 날도 보이고 고를 수 있다.
// 파편이 아예 없는 날만 눌리지 않는다.
export function MonthCalendar({
  initial,
  today,
  byDay,
  onSelect,
  onClose,
}: {
  initial: Date;
  today: Date;
  byDay: Record<string, DayMark[]>;
  onSelect: (d: Date) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(initial));

  return (
    <Animated.View entering={FadeInUp} exiting={FadeOutUp} style={styles.panel}>
      <View style={styles.head}>
        <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={12}>
          <Text style={styles.nav}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <Pressable
          onPress={() => setMonth(addMonths(month, 1))}
          hitSlop={12}
          disabled={month >= startOfMonth(today)}
        >
          <Text style={[styles.nav, month >= startOfMonth(today) && styles.navOff]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekdayHeader}>
        {WEEKDAY_LABELS.map((label) => (
          <Text key={label} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      {monthWeekStarts(month).map((weekStart) => (
        <View key={weekStart.toISOString()} style={styles.weekRow}>
          {Array.from({ length: 7 }, (_, i) => {
            const day = addDays(weekStart, i);
            const key = dayKey(day.toISOString());
            const frs = byDay[key] ?? [];
            const isOutside = day.getMonth() !== month.getMonth();
            return (
              <Pressable
                key={key}
                style={styles.dayCell}
                disabled={frs.length === 0}
                onPress={() => onSelect(day)}
              >
                <Text
                  style={[
                    styles.dayNum,
                    key === dayKey(today.toISOString()) && styles.dayNumToday,
                    (isOutside || frs.length === 0) && styles.dayNumFaint,
                  ]}
                >
                  {day.getDate()}
                </Text>
                <View style={styles.marks}>
                  <DensityMark fragments={frs} today={today} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <Pressable onPress={onClose} style={styles.close} hitSlop={8}>
        <Text style={styles.closeLabel}>닫기</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.canvasElevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  nav: { ...type.headingMd, color: colors.body, fontFamily: fonts.sans },
  navOff: { color: colors.faint },
  monthLabel: {
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sansSemiBold,
    minWidth: 56,
    textAlign: 'center',
  },
  weekdayHeader: { flexDirection: 'row', paddingBottom: spacing.xxs },
  weekdayLabel: {
    ...type.bodySm,
    flex: 1,
    textAlign: 'center',
    color: colors.mute,
    fontFamily: fonts.sans,
  },
  weekRow: { flexDirection: 'row', height: 44 },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
    marginHorizontal: 2,
    borderRadius: rounded.sm,
  },
  dayNum: { ...type.labelSm, color: colors.ink, fontFamily: fonts.sansMedium },
  dayNumToday: { color: colors.link },
  dayNumFaint: { color: colors.faint },
  marks: { alignItems: 'center', justifyContent: 'center', minHeight: 10 },
  close: { alignSelf: 'center', paddingTop: spacing.xs },
  closeLabel: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sansMedium },
});
