import { effectiveTier, opacity, vividness } from '../src/lib/vividness';

const NOW = new Date('2026-07-12T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('opacity — SPEC §5 확정값 (PLAN.md §3.4)', () => {
  test('pinned는 감쇠 없음', () => {
    expect(opacity(daysAgo(0), 'pinned', NOW)).toBe(1);
    expect(opacity(daysAgo(1000), 'pinned', NOW)).toBe(1);
  });

  test('normal: 7일까지 100%', () => {
    expect(opacity(daysAgo(0), 'normal', NOW)).toBe(1);
    expect(opacity(daysAgo(7), 'normal', NOW)).toBe(1);
  });

  test('normal: 7일~30일 선형 감쇠', () => {
    expect(opacity(daysAgo(18.5), 'normal', NOW)).toBeCloseTo(0.625); // 중간점
    expect(opacity(daysAgo(8), 'normal', NOW)).toBeLessThan(1);
    expect(opacity(daysAgo(29), 'normal', NOW)).toBeGreaterThan(0.25);
  });

  test('normal: 30일 이후 바닥 25% 고정', () => {
    expect(opacity(daysAgo(30), 'normal', NOW)).toBe(0.25);
    expect(opacity(daysAgo(365), 'normal', NOW)).toBe(0.25);
  });

  test('important: 30일까지 100%, 90일에 바닥', () => {
    expect(opacity(daysAgo(30), 'important', NOW)).toBe(1);
    expect(opacity(daysAgo(60), 'important', NOW)).toBeCloseTo(0.625); // 중간점
    expect(opacity(daysAgo(90), 'important', NOW)).toBe(0.25);
    expect(opacity(daysAgo(365), 'important', NOW)).toBe(0.25);
  });

  test('미래 timestamp(시계 오차)는 100%로 clamp', () => {
    expect(opacity(daysAgo(-3), 'normal', NOW)).toBe(1);
  });
});

// 회상에서 구해낸 횟수가 곧 중요도 — 손으로 tier를 올릴 필요가 없다
describe('effectiveTier — 자라나는 중요도', () => {
  test('두 번 이상 구해낸 normal은 important처럼 버틴다', () => {
    expect(effectiveTier('normal', 0)).toBe('normal');
    expect(effectiveTier('normal', 1)).toBe('normal');
    expect(effectiveTier('normal', 2)).toBe('important');
  });

  test('수동 지정이 자동 추론을 이긴다', () => {
    expect(effectiveTier('pinned', 0)).toBe('pinned');
    expect(effectiveTier('important', 0)).toBe('important');
  });

  test('40일 전 파편: 한 번도 안 구해냈으면 바닥, 두 번 구해냈으면 아직 살아있다', () => {
    const fr = (touch_count: number) => ({
      last_touched_at: daysAgo(40).toISOString(),
      tier: 'normal' as const,
      touch_count,
    });
    expect(vividness(fr(0), NOW)).toBe(0.25); // normal은 30일에 바닥
    expect(vividness(fr(2), NOW)).toBeGreaterThan(0.8); // important 곡선 (30일부터 감쇠 시작)
  });
});
