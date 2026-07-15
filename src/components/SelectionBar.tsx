import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 선택 모드 하단 바 — 합치기 전용. 취소는 선택 해제, 큐·진행률 표시 없음 (SPEC §7).
export function SelectionBar({
  count,
  onMerge,
  onCancel,
}: {
  count: number;
  onMerge: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.bar}>
      <Pressable onPress={onCancel} hitSlop={12}>
        <Text style={styles.cancel}>취소</Text>
      </Pressable>
      <Text style={styles.count}>{count}개 선택</Text>
      <Pressable
        onPress={onMerge}
        disabled={count < 2}
        style={[styles.mergeBtn, count < 2 && styles.mergeBtnDisabled]}
      >
        <Text style={styles.mergeLabel}>합치기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  cancel: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sansMedium },
  count: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  mergeBtn: {
    backgroundColor: colors.ink,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  mergeBtnDisabled: { opacity: 0.35 },
  mergeLabel: { ...type.bodyMd, color: colors.onInk, fontFamily: fonts.sansMedium },
});
