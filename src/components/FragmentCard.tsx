import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { formatTime } from '@/lib/dates';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { useImageUrl } from '@/lib/useImageUrl';

const TIER_LABEL: Record<string, string> = { important: 'IMPORTANT', pinned: 'PINNED' };

// 선명도는 카드 전체(보더 포함)에 opacity로 — 다크 캔버스 속으로 가라앉는 지층감 (PLAN §6.5)
export function FragmentCard({
  fragment,
  opacity,
  projectsById,
}: {
  fragment: Fragment;
  opacity: number;
  projectsById?: Record<string, string>;
}) {
  // 이 파편이 속한 프로젝트 이름들 — 맵이 있고 해석되는 것만 (Inbox면 빈 배열)
  const projectNames = projectsById
    ? fragment.project_ids.map((id) => projectsById[id]).filter(Boolean)
    : [];
  return (
    <View style={[styles.card, { opacity }]}>
      <CardBody fragment={fragment} />
      <View style={styles.meta}>
        <Text style={styles.eyebrow}>{fragment.type.toUpperCase()}</Text>
        {fragment.tier !== 'normal' && (
          <Text style={styles.eyebrow}>{TIER_LABEL[fragment.tier]}</Text>
        )}
        {fragment.merged_from.length > 0 && (
          <Text style={styles.eyebrow}>+{fragment.merged_from.length}</Text>
        )}
        {fragment.note && (
          <Text style={styles.eyebrow}>✎</Text>
        )}
        {projectNames.map((name) => (
          <View key={name} style={styles.projectTag}>
            <Text style={styles.projectTagLabel}>{name}</Text>
          </View>
        ))}
        <Text style={[styles.eyebrow, styles.time]}>{formatTime(fragment.created_at)}</Text>
      </View>
    </View>
  );
}

function CardBody({ fragment }: { fragment: Fragment }) {
  switch (fragment.type) {
    case 'link':
      return (
        <View style={styles.linkRow}>
          <View style={styles.linkTextCol}>
            {fragment.link_title && (
              <Text style={styles.linkTitle} numberOfLines={2}>
                {fragment.link_title}
              </Text>
            )}
            <Text style={styles.linkUrl} numberOfLines={1}>
              {fragment.content}
            </Text>
          </View>
          {fragment.link_thumbnail_url?.startsWith('http') && (
            <Image source={fragment.link_thumbnail_url} style={styles.thumb} />
          )}
        </View>
      );
    case 'quote':
      return (
        <View style={styles.quoteRow}>
          <View style={styles.quoteBar} />
          <Text style={styles.quoteText}>{fragment.content}</Text>
        </View>
      );
    case 'image':
      return <ImageBody fragment={fragment} />;
    default:
      return (
        <Text style={styles.body} numberOfLines={8}>
          {fragment.content}
        </Text>
      );
  }
}

// URL이 오기 전까지는 빈 well — 다크 캔버스 위에서 자리만 잡고 조용히 채워진다
function ImageBody({ fragment }: { fragment: Fragment }) {
  const url = useImageUrl(fragment.image_path);
  return (
    <View>
      <Image source={url} style={styles.imageWell} contentFit="cover" transition={200} />
      {fragment.content !== '' && <Text style={styles.body}>{fragment.content}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    padding: spacing.card,
  },
  body: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sans },
  meta: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  eyebrow: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },
  time: { marginLeft: 'auto' },
  projectTag: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  projectTagLabel: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  linkRow: { flexDirection: 'row', gap: spacing.sm },
  linkTextCol: { flex: 1, gap: spacing.xxs },
  linkTitle: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium },
  linkUrl: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  thumb: { width: 52, height: 52, borderRadius: rounded.sm, backgroundColor: colors.hairlineSoft },
  quoteRow: { flexDirection: 'row', gap: spacing.sm },
  quoteBar: { width: 2, backgroundColor: colors.ink, borderRadius: 1 },
  quoteText: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sans, flex: 1 },
  imageWell: {
    height: 140,
    borderRadius: rounded.sm,
    backgroundColor: colors.hairlineSoft,
    marginBottom: spacing.xs,
  },
});
