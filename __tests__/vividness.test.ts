import { opacity } from '../src/lib/vividness';

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
