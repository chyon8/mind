import { effectiveTier, opacity, vividness } from '../src/lib/vividness';

const NOW = new Date('2026-07-12T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('opacity — SPEC §5 확정값 (PLAN.md §3.4)', () => {
  test('pinned는 감쇠 없음', () => {
    expect(opacity(daysAgo(0), 'pinned', NOW)).toBe(1);
    expect(opacity(daysAgo(1000), 'pinned', NOW)).toBe(1);
  });

  test('normal: 3일까지 100%', () => {
    expect(opacity(daysAgo(0), 'normal', NOW)).toBe(1);
    expect(opacity(daysAgo(3), 'normal', NOW)).toBe(1);
  });

  test('normal: 3일~14일 선형 감쇠', () => {
    expect(opacity(daysAgo(8.5), 'normal', NOW)).toBeCloseTo(0.625); // 중간점
    expect(opacity(daysAgo(4), 'normal', NOW)).toBeLessThan(1);
    expect(opacity(daysAgo(13), 'normal', NOW)).toBeGreaterThan(0.25);
  });

  test('normal: 14일 이후 바닥 25% 고정', () => {
    expect(opacity(daysAgo(14), 'normal', NOW)).toBe(0.25);
    expect(opacity(daysAgo(365), 'normal', NOW)).toBe(0.25);
  });

  test('important: 14일까지 100%, 45일에 바닥', () => {
    expect(opacity(daysAgo(14), 'important', NOW)).toBe(1);
    expect(opacity(daysAgo(29.5), 'important', NOW)).toBeCloseTo(0.625); // 중간점
    expect(opacity(daysAgo(45), 'important', NOW)).toBe(0.25);
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

  test('20일 전 파편: 한 번도 안 구해냈으면 바닥, 두 번 구해냈으면 아직 살아있다', () => {
    const fr = (touch_count: number) => ({
      last_touched_at: daysAgo(20).toISOString(),
      tier: 'normal' as const,
      touch_count,
    });
    expect(vividness(fr(0), NOW)).toBe(0.25); // normal은 14일에 바닥
    expect(vividness(fr(2), NOW)).toBeGreaterThan(0.8); // important 곡선 (14일부터 감쇠 시작)
  });
});
