import type { Tier } from './types';

// PLAN.md §3.4 — 선명도는 저장하지 않는다. 렌더링 시점에 계산 (SPEC §5 확정값).
// 2026-07-22 조정: [3,14]/[14,45]·floor .25는 실사용에서 "애초에 흐려지질 않는다"였다.
// 실측(파편 127개, 코퍼스 6.5일): 바닥에 닿은 게 0개, 제일 오래된 것도 0.76이라
// 100%와 눈으로 구분이 안 됐다. 일주일이면 흐려지는 게 체감되게 낮춘 값.
const DECAY: Record<Exclude<Tier, 'pinned'>, [start: number, floor: number]> = {
  normal: [1, 7],
  important: [7, 21],
};

const FLOOR_OPACITY = 0.15;
const MS_PER_DAY = 86_400_000;

export function opacity(lastTouchedAt: Date, tier: Tier, now: Date = new Date()): number {
  if (tier === 'pinned') return 1;

  // 음수(미래 timestamp)는 0으로 clamp — 시계 오차 방어
  const days = Math.max(0, (now.getTime() - lastTouchedAt.getTime()) / MS_PER_DAY);
  const [start, floor] = DECAY[tier];

  if (days <= start) return 1;
  if (days >= floor) return FLOOR_OPACITY;
  return 1 - (1 - FLOOR_OPACITY) * ((days - start) / (floor - start));
}

// 회상에서 두 번 이상 구해낸 파편은 잘 안 잊힌다 — 중요도를 손으로 정할 필요가 없다.
// 수동 tier는 그대로 우선한다 (명시적 지정이 자동 추론을 이긴다).
export function effectiveTier(tier: Tier, touchCount: number): Tier {
  if (tier !== 'normal') return tier;
  return touchCount >= 2 ? 'important' : 'normal';
}

// 화면에서 쓰는 실제 선명도. 파편이 들고 있는 값만으로 계산된다.
export function vividness(
  fr: { last_touched_at: string; tier: Tier; touch_count: number },
  now?: Date,
): number {
  return opacity(new Date(fr.last_touched_at), effectiveTier(fr.tier, fr.touch_count), now);
}
