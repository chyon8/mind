// 아침 브리핑의 그림들 (RUDY.md §4-F5 개정 — 2026-08-01 유저가 시각화를 허용).
//
// **색을 안 쓴다.** Design.md는 무채색 듀엣이고, 이 앱엔 이미 더 좋은 시각 언어가 있다 —
// **선명도(opacity)** 다. 파편이 흐려지는 걸 화면에서 이미 opacity로 보고 있으므로,
// 그래프도 같은 문법으로 그리면 범례를 읽지 않아도 "가라앉고 있다"가 그냥 보인다.
// 막대에 색을 칠하는 순간 그건 남의 대시보드가 된다.
//
// SVG 라이브러리를 안 쓴다 — 전부 View다. Design.md의 "line-weight vector, ink on white"가
// 원래 이 결이고, 네이티브 모듈이 늘면 dev client를 다시 빌드해야 한다.

import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 바닥(0.15)에 닿아도 완전히 안 보이면 "없음"과 구분이 안 된다 — 최소 가시성을 준다.
const ink = (v: number) => Math.max(0.18, Math.min(1, v));

export function Eyebrow({ children, right }: { children: string; right?: string }) {
  return (
    <View style={styles.eyebrowRow}>
      <Text style={styles.eyebrow}>{children}</Text>
      {!!right && <Text style={styles.eyebrowRight}>{right}</Text>}
    </View>
  );
}

/** 축 타임라인 — 최근 30일. 왼쪽이 과거, 오른쪽이 오늘. 도트의 진하기 = 그 날 파편의 선명도. */
export function AxisTimeline({ marks, days = 30 }: { marks: { offset: number; vividness: number }[]; days?: number }) {
  const byOffset = new Map(marks.map((m) => [m.offset, m.vividness]));
  return (
    <View style={styles.timeline}>
      {Array.from({ length: days }, (_, i) => {
        const offset = days - 1 - i; // 왼쪽 = 오래된 쪽
        const v = byOffset.get(offset);
        return (
          <View
            key={offset}
            style={[
              styles.tick,
              v == null
                ? styles.tickEmpty
                : { backgroundColor: colors.ink, opacity: ink(v) },
            ]}
          />
        );
      })}
    </View>
  );
}

/** 선명도 지형 — 저장소 전체가 지금 어느 층에 몰려 있나. 한 줄 스택 바. */
export function BandBar({ bands }: { bands: { label: string; count: number }[] }) {
  const total = bands.reduce((n, b) => n + b.count, 0) || 1;
  // 또렷함 → 바닥 순으로 진하기가 떨어진다. 바 자체가 감쇠 곡선이 된다.
  const opacities = [1, 0.5, 0.22];
  return (
    <View style={styles.bandWrap}>
      <View style={styles.bandBar}>
        {bands.map((b, i) => (
          <View
            key={b.label}
            style={{
              flex: Math.max(b.count, 0.001),
              backgroundColor: colors.ink,
              opacity: opacities[i] ?? 0.22,
            }}
          />
        ))}
      </View>
      <View style={styles.legendRow}>
        {bands.map((b, i) => (
          <View key={b.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { opacity: opacities[i] ?? 0.22 }]} />
            <Text style={styles.legendLabel}>{b.label}</Text>
            <Text style={styles.legendCount}>{b.count}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.bandFoot}>{total}개 중</Text>
    </View>
  );
}

/** 저장 리듬 — 최근 14일 일별 개수. 오른쪽이 오늘. */
export function RhythmBars({ rhythm }: { rhythm: { offset: number; count: number }[] }) {
  const max = Math.max(1, ...rhythm.map((r) => r.count));
  const ordered = [...rhythm].sort((a, b) => b.offset - a.offset); // 왼쪽 = 오래된 쪽
  return (
    <View>
      <View style={styles.rhythmRow}>
        {ordered.map((r) => (
          <View key={r.offset} style={styles.rhythmSlot}>
            <View
              style={[
                styles.rhythmBar,
                {
                  height: r.count === 0 ? 2 : Math.max(4, (r.count / max) * 44),
                  opacity: r.count === 0 ? 0.18 : 0.35 + 0.65 * (r.count / max),
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.rhythmAxis}>
        <Text style={styles.axisLabel}>{ordered.length}일 전</Text>
        <Text style={styles.axisLabel}>오늘</Text>
      </View>
    </View>
  );
}

/** 조용한 프로젝트 — 며칠째 아무것도 안 붙었나. 게이지는 30일 기준. */
export function QuietRow({ name, days, total }: { name: string; days: number; total: number }) {
  const ratio = Math.min(1, days / 30);
  return (
    <View style={styles.quietRow}>
      <View style={styles.quietHead}>
        <Text style={styles.quietName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.quietDays}>{days >= 999 ? '한 번도' : `${days}일째`}</Text>
      </View>
      <View style={styles.quietTrack}>
        <View style={[styles.quietFill, { flex: Math.max(ratio, 0.02), opacity: 0.25 + 0.5 * ratio }]} />
        <View style={{ flex: Math.max(1 - ratio, 0.001) }} />
      </View>
      <Text style={styles.quietMeta}>파편 {total}개</Text>
    </View>
  );
}

/**
 * 관심의 결이 어디로 움직였나 — 최근 7일 vs 그 앞 3주.
 *
 * ⚠️ 여기 **단어 빈도를 그리지 마라.** 2026-08-01에 워드클라우드류를 만들었다가 버렸다 —
 *    단어를 세면 조사·URL 조각이 상위를 먹고, 걸러내도 남는 건 카운트지 의미가 아니다.
 *    한 줄 = 의미로 뭉친 덩어리 하나(임베딩 클러스터)다.
 *
 * 막대는 왼쪽이 이전, 오른쪽이 최근 — 무게가 어느 쪽으로 쏠렸는지가 그대로 보인다.
 */
export function AxisShift({
  axes,
}: {
  axes: { label: string; recent: number; prior: number; quietDays: number }[];
}) {
  const max = Math.max(1, ...axes.map((a) => Math.max(a.recent, a.prior)));
  const sorted = [...axes].sort((a, b) => b.recent - a.recent || a.prior - b.prior);

  return (
    <View style={styles.shiftRoot}>
      {sorted.map((a) => {
        const note =
          a.prior === 0 ? '새로 생김'
          : a.recent === 0 ? `${a.quietDays}일째 조용`
          : a.recent > a.prior ? '굵어지는 중'
          : a.recent < a.prior ? '잦아드는 중'
          : '그대로';
        return (
          <View key={a.label} style={styles.shiftRow}>
            <View style={styles.shiftHead}>
              <Text style={styles.shiftLabel} numberOfLines={1}>
                {a.label}
              </Text>
              <Text style={styles.shiftNote}>{note}</Text>
            </View>
            <View style={styles.shiftBars}>
              {/* 이전 — 오른쪽 정렬로 자라서 가운데 축에서 만난다 */}
              <View style={styles.shiftLeft}>
                <View style={[styles.shiftBar, { flex: a.prior / max || 0.001, opacity: 0.3 }]} />
              </View>
              <View style={styles.shiftAxis} />
              <View style={styles.shiftRight}>
                <View style={[styles.shiftBar, { flex: a.recent / max || 0.001, opacity: 0.95 }]} />
              </View>
            </View>
          </View>
        );
      })}
      <View style={styles.shiftLegend}>
        <Text style={styles.shiftLegendText}>← 그 앞 3주</Text>
        <Text style={styles.shiftLegendText}>최근 7일 →</Text>
      </View>
    </View>
  );
}

/** 파편 한 줄 — 선명도가 그대로 글자 진하기다. 목록에서 뭐가 가라앉는지가 그냥 보인다. */
export function ItemLine({
  title,
  vividness,
  projects,
  trailing,
}: {
  title: string;
  vividness?: number;
  projects?: string[];
  trailing?: string;
}) {
  return (
    <View style={[styles.itemLine, vividness != null && { opacity: ink(vividness) }]}>
      <View style={styles.bullet} />
      <Text style={styles.itemText} numberOfLines={2}>
        {title}
      </Text>
      {projects?.slice(0, 2).map((p) => (
        <View key={p} style={styles.tag}>
          <Text style={styles.tagLabel}>{p}</Text>
        </View>
      ))}
      {!!trailing && <Text style={styles.itemTrailing}>{trailing}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  eyebrow: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },
  eyebrowRight: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono, marginLeft: 'auto' },

  timeline: { flexDirection: 'row', gap: 2, alignItems: 'center', height: 18 },
  tick: { flex: 1, height: 14, borderRadius: 1 },
  tickEmpty: { backgroundColor: colors.hairline, opacity: 0.55, height: 3 },

  bandWrap: { gap: spacing.sm },
  bandBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.hairlineSoft,
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  legendDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.ink },
  legendLabel: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  legendCount: { ...type.bodySm, color: colors.ink, fontFamily: fonts.sansMedium },
  bandFoot: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans },

  rhythmRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 48 },
  rhythmSlot: { flex: 1, alignItems: 'stretch', justifyContent: 'flex-end' },
  rhythmBar: { backgroundColor: colors.ink, borderRadius: 2 },
  rhythmAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xxs },
  axisLabel: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono },

  quietRow: { gap: spacing.xxs },
  quietHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  quietName: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sans, flexShrink: 1 },
  quietDays: { ...type.bodySm, color: colors.mute, fontFamily: fonts.mono, marginLeft: 'auto' },
  quietTrack: { flexDirection: 'row', height: 4, borderRadius: 2, backgroundColor: colors.hairlineSoft, overflow: 'hidden' },
  quietFill: { backgroundColor: colors.ink },
  quietMeta: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans },

  shiftRoot: { gap: spacing.sm },
  shiftRow: { gap: spacing.xxs },
  shiftHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  shiftLabel: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium, flexShrink: 1 },
  shiftNote: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono, marginLeft: 'auto' },
  shiftBars: { flexDirection: 'row', alignItems: 'center', height: 8 },
  shiftLeft: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  shiftRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-start' },
  shiftBar: { backgroundColor: colors.ink, height: 8, borderRadius: 2 },
  shiftAxis: { width: StyleSheet.hairlineWidth * 2, height: 12, backgroundColor: colors.hairline },
  shiftLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xxs },
  shiftLegendText: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono },

  itemLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xxs },
  bullet: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.mute },
  itemText: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sans, flexShrink: 1 },
  tag: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  tagLabel: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  itemTrailing: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono, marginLeft: 'auto' },
});
