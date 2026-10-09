import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { formatTime } from '@/lib/dates';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { useImageUrl } from '@/lib/useImageUrl';

// 중요/고정 표시 (2026-07-29 유저 요청: "중요로 체크하면 별표든 뭐든 눈에 띄게").
// 전엔 'IMPORTANT'를 다른 eyebrow와 **같은 faint 회색**으로 찍어서 사실상 안 보였다 —
// 글자를 마크로 바꾸고 메타 줄 맨 앞에 둬서 시선이 먼저 닿게.
// 2026-10-09: 그래도 흐려진 카드에선 별이 같이 흐려져 안 보였다 — 색을 link로 바꾸고,
// 선명도 opacity를 카드 전체가 아니라 별을 뺀 나머지에만 건다.
const TIER_MARK: Record<string, string> = { important: '★', pinned: '⚑' };

// 선명도는 카드(보더 포함)에 opacity로 — 다크 캔버스 속으로 가라앉는 지층감 (PLAN §6.5).
// 별만 흐려지지 않게 하려고 배경·보더(frame)와 내용에 opacity를 따로 건다.
export function FragmentCard({
  fragment,
  opacity,
  projectsById,
  similarCount = 0,
}: {
  fragment: Fragment;
  opacity: number;
  projectsById?: Record<string, string>;
  similarCount?: number; // 비슷한 파편 개수 (rudy.similar_counts). 0이면 안 그린다
}) {
  // 이 파편이 속한 프로젝트 이름들 — 맵이 있고 해석되는 것만 (Inbox면 빈 배열)
  const projectNames = projectsById
    ? fragment.project_ids.map((id) => projectsById[id]).filter(Boolean)
    : [];
  return (
    <View style={styles.card}>
      <View style={[StyleSheet.absoluteFill, styles.frame, { opacity }]} />
      <View style={{ opacity }}>
        <CardBody fragment={fragment} />
        {fragment.note ? (
          <View style={styles.noteWrap}>
            <Text style={styles.noteText} numberOfLines={3}>
              {fragment.note}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        {fragment.tier !== 'normal' && (
          <Text style={styles.tierMark}>{TIER_MARK[fragment.tier]}</Text>
        )}
        <View style={[styles.metaRest, { opacity }]}>
          <Text style={styles.eyebrow}>{fragment.type.toUpperCase()}</Text>
          {fragment.merged_from.length > 0 && (
            <Text style={styles.eyebrow}>+{fragment.merged_from.length}</Text>
          )}
          {similarCount > 0 && <Text style={styles.eyebrow}>≈{similarCount}</Text>}
          {projectNames.map((name) => (
            <View key={name} style={styles.projectTag}>
              <Text style={styles.projectTagLabel}>{name}</Text>
            </View>
          ))}
          <Text style={[styles.eyebrow, styles.time]}>{formatTime(fragment.created_at)}</Text>
        </View>
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
          <Text style={styles.quoteText} numberOfLines={5}>
            {fragment.content}
          </Text>
        </View>
      );
    case 'image':
      return <ImageBody fragment={fragment} />;
    default:
      return (
        <Text style={styles.body} numberOfLines={5}>
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
      {fragment.content !== '' && (
        <Text style={styles.body} numberOfLines={3}>
          {fragment.content}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.card },
  frame: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
  },
  body: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sans },
  meta: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  metaRest: { flex: 1, flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  eyebrow: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },
  // 마크는 mono가 아니라 sans — ★·⚑는 고정폭 폰트에 글리프가 없거나 깨질 수 있다.
  tierMark: { fontSize: 14, lineHeight: 16, color: colors.link, fontFamily: fonts.sans },
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
  noteWrap: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
  },
  noteText: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
});
