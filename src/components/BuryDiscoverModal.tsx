import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

export type BuryChoice = 'release' | 'keep' | null; // null = 묻지 않는다

// "다음 발견에 포함" 지정된 파편을 묻을 때 물어본다 — DatePickerModal과 같은 등장/퇴장
// 그래머(스프링 카드 + 백드롭)를 써서 앱 전체에서 "모달"이 같은 느낌이게 한다. Alert.alert는
// OS 네이티브 UI라 다크 캔버스 위에서 튄다 — 여기선 안 쓴다.
export function BuryDiscoverModal({ onChoice }: { onChoice: (choice: BuryChoice) => void }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(1, { damping: 20, stiffness: 260, mass: 0.9 });
  }, [progress]);

  function dismiss(choice: BuryChoice) {
    progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(onChoice, choice);
    });
  }

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 24 },
      { scale: 0.95 + progress.value * 0.05 },
    ],
  }));

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss(null)} />
      <View style={styles.centerWrap} pointerEvents="box-none">
        <Animated.View style={[styles.card, cardStyle]}>
          <Text style={styles.title}>발견에 포함된 파편</Text>
          <Text style={styles.message}>
            이 파편은 다음 발견에 포함하도록 지정돼 있다. 지정을 유지하면 묻힌 뒤에도 브리핑에
            나온다.
          </Text>

          <Pressable style={styles.primaryBtn} onPress={() => dismiss('release')}>
            <Text style={styles.primaryLabel}>지정 풀고 묻기</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={() => dismiss('keep')}>
            <Text style={styles.secondaryLabel}>유지하고 묻기</Text>
          </Pressable>

          <View style={styles.footer}>
            <Pressable onPress={() => dismiss(null)} hitSlop={8}>
              <Text style={styles.footerLink}>취소</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 30 },
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
  title: {
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sansSemiBold,
    marginBottom: spacing.xs,
  },
  message: {
    ...type.bodyMd,
    lineHeight: 21,
    color: colors.mute,
    fontFamily: fonts.sans,
    marginBottom: spacing.md,
  },
  primaryBtn: {
    backgroundColor: colors.ink,
    borderRadius: rounded.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  primaryLabel: { ...type.bodyMd, color: colors.onInk, fontFamily: fonts.sansMedium },
  secondaryBtn: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  footerLink: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sansMedium },
});
