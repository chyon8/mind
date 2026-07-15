import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { formatTime } from '@/lib/dates';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { useImageUrl } from '@/lib/useImageUrl';

// 메모처럼 촘촘한 불릿 한 줄 — 데일리 뷰, 프로젝트 상세에서 사용 (PLAN.md §6.1)
export function FragmentBullet({
  fragment,
  rowOpacity = 1,
}: {
  fragment: Fragment;
  rowOpacity?: number;
}) {
  const isImage = fragment.type === 'image';
  const imageUrl = useImageUrl(isImage ? fragment.image_path : null);
  const line =
    fragment.type === 'link'
      ? (fragment.link_title ?? fragment.content)
      : isImage
        ? fragment.content // 캡션 없으면 빈 줄 — 썸네일이 이미 그 자리에 있다
        : fragment.content.replace(/\n/g, ' ');
  return (
    <View style={[styles.row, { opacity: rowOpacity }]}>
      {/* 썸네일이 불릿 자리를 대신한다 — 행 높이는 그대로 (PLAN.md §6.1) */}
      {isImage ? (
        <Image source={imageUrl} style={styles.thumb} contentFit="cover" transition={200} />
      ) : (
        <Text style={styles.bullet}>·</Text>
      )}
      <Text
        style={[styles.text, fragment.type === 'quote' && styles.quoteText]}
        numberOfLines={2}
      >
        {line}
      </Text>
      {fragment.merged_from.length > 0 && (
        <Text style={styles.time}>+{fragment.merged_from.length}</Text>
      )}
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
  thumb: {
    width: 24,
    height: 24,
    marginTop: 1, // 24px 행 높이의 텍스트와 광학적으로 맞춤
    borderRadius: rounded.sm,
    backgroundColor: colors.hairlineSoft,
  },
  text: { ...type.bodyMd, lineHeight: 24, color: colors.ink, fontFamily: fonts.sans, flex: 1 },
  quoteText: { color: colors.body },
  time: { ...type.bodySm, lineHeight: 24, color: colors.faint, fontFamily: fonts.mono },
});
