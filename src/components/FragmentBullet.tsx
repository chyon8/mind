import { StyleSheet, Text, View } from 'react-native';
import { formatTime } from '@/lib/dates';
import { colors, fonts, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';

// 메모처럼 촘촘한 불릿 한 줄 — 데일리 뷰, 프로젝트 상세에서 사용 (PLAN.md §6.1)
export function FragmentBullet({
  fragment,
  rowOpacity = 1,
}: {
  fragment: Fragment;
  rowOpacity?: number;
}) {
  const line =
    fragment.type === 'link'
      ? (fragment.link_title ?? fragment.content)
      : fragment.type === 'image'
        ? (fragment.content || '(이미지)')
        : fragment.content.replace(/\n/g, ' ');
  return (
    <View style={[styles.row, { opacity: rowOpacity }]}>
      <Text style={styles.bullet}>·</Text>
      <Text
        style={[styles.text, fragment.type === 'quote' && styles.quoteText]}
        numberOfLines={2}
      >
        {line}
      </Text>
      <Text style={styles.time}>{formatTime(fragment.created_at)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.canvas,
  },
  bullet: { ...type.bodyLg, color: colors.mute, fontFamily: fonts.sans, lineHeight: 24 },
  text: { ...type.bodyMd, lineHeight: 24, color: colors.ink, fontFamily: fonts.sans, flex: 1 },
  quoteText: { color: colors.body },
  time: { ...type.bodySm, lineHeight: 24, color: colors.faint, fontFamily: fonts.mono },
});
