import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 오늘에서 벗어나 있을 때만 나타난다. 대부분의 시간은 이미 오늘에 있으므로
// 상시 버튼은 90%의 시간 동안 의미 없는 군더더기가 된다.
export function TodayPill({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  if (!visible) return null;
  return (
    <Animated.View entering={FadeInDown} exiting={FadeOutDown} style={styles.wrap}>
      <Pressable onPress={onPress} style={styles.pill} hitSlop={8}>
        <Text style={styles.label}>오늘로</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // 던지기 FAB(하단 중앙) 바로 위에 쌓인다
  wrap: { position: 'absolute', bottom: spacing.xl + 48 + spacing.xs, alignSelf: 'center' },
  pill: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  label: { ...type.bodySm, color: colors.body, fontFamily: fonts.sansMedium },
});
