import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 오른쪽→왼쪽 스와이프로 수정/삭제 노출 — 리스트 공통
export function SwipeableRow({
  children,
  onEdit,
  onDelete,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.actions}>
          <Pressable style={[styles.actionBtn, styles.editBtn]} onPress={onEdit}>
            <Text style={styles.editLabel}>수정</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.deleteBtn]} onPress={onDelete}>
            <Text style={styles.deleteLabel}>삭제</Text>
          </Pressable>
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.xxs, marginLeft: spacing.xs },
  actionBtn: {
    width: 64,
    borderRadius: rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  editBtn: { backgroundColor: colors.hairlineSoft },
  deleteBtn: { backgroundColor: 'rgba(255, 77, 77, 0.14)' },
  editLabel: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium },
  deleteLabel: { ...type.bodyMd, color: colors.error, fontFamily: fonts.sansMedium },
});
