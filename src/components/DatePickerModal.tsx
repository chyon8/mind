import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  addDays,
  addMonths,
  dayKey,
  monthLabel,
  monthWeekStarts,
  startOfMonth,
  toDateKey,
  WEEKDAY_LABELS,
} from '@/lib/dates';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// 날짜 하나를 고르는 범용 모던 date picker. input.tsx 새 파편 모달과 같은
// 등장/퇴장 그래머(스프링 카드 + 백드롭)를 써서 앱 전체에서 "모달"이 같은 느낌이게 한다.
// MonthCalendar(피드 날짜 점프용, 파편 밀도로 날짜를 비활성화함)와는 용도가 달라 분리했다 —
// 여기는 모든 날짜가 선택 가능해야 한다.
export function DatePickerModal({
  value,
  onSelect,
  onClose,
}: {
  value: Date | null;
  onSelect: (dateKey: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(value ?? new Date()));
  const progress = useSharedValue(0);
  const today = new Date();

  useEffect(() => {
    progress.value = withSpring(1, { damping: 20, stiffness: 260, mass: 0.9 });
  }, [progress]);

  function dismiss(then?: () => void) {
    progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(then ?? onClose);
    });
  }

  function pick(day: Date) {
    const key = toDateKey(day);
    dismiss(() => onSelect(key));
  }

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 24 },
      { scale: 0.95 + progress.value * 0.05 },
    ],
  }));

  const selectedKey = value ? dayKey(value.toISOString()) : null;
  const todayKey = dayKey(today.toISOString());

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <AnimatedPressable style={[styles.backdrop, backdropStyle]} onPress={() => dismiss()} />
      <View style={styles.centerWrap} pointerEvents="box-none">
        <Animated.View style={[styles.card, cardStyle]}>
          <View style={styles.head}>
            <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={12}>
              <Text style={styles.nav}>‹</Text>
            </Pressable>
            <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
            <Pressable onPress={() => setMonth(addMonths(month, 1))} hitSlop={12}>
              <Text style={styles.nav}>›</Text>
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
                const isOutside = day.getMonth() !== month.getMonth();
                const isSelected = key === selectedKey;
                const isToday = key === todayKey;
                return (
                  <Pressable key={key} style={styles.dayCell} onPress={() => pick(day)}>
                    <View style={[styles.dayCircle, isSelected && styles.dayCircleSelected]}>
                      <Text
                        style={[
                          styles.dayNum,
                          isOutside && styles.dayNumFaint,
                          isToday && !isSelected && styles.dayNumToday,
                          isSelected && styles.dayNumSelected,
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={styles.footer}>
            <Pressable onPress={() => pick(today)} hitSlop={8}>
              <Text style={styles.footerLink}>오늘</Text>
            </Pressable>
            <Pressable onPress={() => dismiss()} hitSlop={8}>
              <Text style={[styles.footerLink, styles.footerClose]}>닫기</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.lg,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 24,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  nav: { ...type.headingMd, color: colors.body, fontFamily: fonts.sans },
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
  dayCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleSelected: { backgroundColor: colors.ink },
  dayNum: { ...type.labelSm, color: colors.ink, fontFamily: fonts.sansMedium },
  dayNumToday: { color: colors.link },
  dayNumFaint: { color: colors.faint },
  dayNumSelected: { color: colors.onInk },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  footerLink: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  footerClose: { color: colors.mute },
});
