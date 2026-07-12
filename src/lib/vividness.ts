import type { Tier } from './types';

// PLAN.md §3.4 — 선명도는 저장하지 않는다. 렌더링 시점에 계산 (SPEC §5 확정값).
const DECAY: Record<Exclude<Tier, 'pinned'>, [start: number, floor: number]> = {
  normal: [7, 30],
  important: [30, 90],
};

const FLOOR_OPACITY = 0.25;
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
