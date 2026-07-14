import { addDays, monthWeekStarts, startOfMonth, startOfWeek } from '../src/lib/dates';

describe('monthWeekStarts', () => {
  // 높이가 달마다 출렁이면 스냅이 흔들린다 — 6행은 타협 불가
  it('언제나 6주를 낸다', () => {
    for (let m = 0; m < 12; m++) {
      expect(monthWeekStarts(new Date(2026, m, 1))).toHaveLength(6);
    }
    // 1일이 토요일인 달 = 그리드가 가장 길게 밀리는 최악의 경우
    expect(monthWeekStarts(new Date(2026, 7, 1)).length).toBe(6);
  });

  it('모든 행이 일요일에 시작한다', () => {
    for (const w of monthWeekStarts(new Date(2026, 6, 14))) {
      expect(w.getDay()).toBe(0);
    }
  });

  it('그 달을 통째로 덮는다', () => {
    const weeks = monthWeekStarts(new Date(2026, 6, 14));
    const first = weeks[0];
    const last = addDays(weeks[5], 6);
    const monthStart = startOfMonth(new Date(2026, 6, 14));
    const monthEnd = new Date(2026, 7, 0); // 7월 31일
    expect(first.getTime()).toBeLessThanOrEqual(monthStart.getTime());
    expect(last.getTime()).toBeGreaterThanOrEqual(monthEnd.getTime());
  });

  it('첫 행은 1일이 든 주다', () => {
    const weeks = monthWeekStarts(new Date(2026, 6, 14));
    expect(weeks[0].getTime()).toBe(startOfWeek(new Date(2026, 6, 1)).getTime());
  });
});
