import { kstRange, kstToday } from '../supabase/functions/_shared/time';

// 이 버그는 하루 9시간 동안만 나타난다 — 수동으로 발견하려면 새벽에 앱을 써야 한다.
// "오늘 뭐 저장했지"가 새벽에만 어제 걸 보여주는 걸 눈으로 잡을 방법이 없어서 테스트로 못 박는다.
describe('kstToday', () => {
  test('KST 새벽은 아직 같은 날 — UTC로는 전날이다', () => {
    // 2026-07-21 01:00 KST = 2026-07-20 16:00 UTC
    expect(kstToday(new Date('2026-07-20T16:00:00Z'))).toBe('2026-07-21');
  });

  test('KST 자정 직전은 그날', () => {
    // 2026-07-20 23:59 KST = 2026-07-20 14:59 UTC
    expect(kstToday(new Date('2026-07-20T14:59:00Z'))).toBe('2026-07-20');
  });

  test('KST 자정 정각에 날이 넘어간다', () => {
    // 2026-07-21 00:00 KST = 2026-07-20 15:00 UTC
    expect(kstToday(new Date('2026-07-20T15:00:00Z'))).toBe('2026-07-21');
  });
});

describe('kstRange', () => {
  const now = new Date('2026-07-20T11:50:00Z'); // 20:50 KST

  test('today는 KST 자정부터 다음 자정까지', () => {
    expect(kstRange('today', now)).toEqual({
      since: '2026-07-19T15:00:00.000Z', // 07-20 00:00 KST
      until: '2026-07-20T15:00:00.000Z', // 07-21 00:00 KST
    });
  });

  test('yesterday는 today 바로 앞 하루', () => {
    const y = kstRange('yesterday', now);
    expect(y.until).toBe(kstRange('today', now).since);
    expect(y.since).toBe('2026-07-18T15:00:00.000Z');
  });

  test('오늘 저장한 파편이 today 범위 안에 든다', () => {
    // 실제로 놓쳤던 파편: 09:22 UTC = 18:22 KST 같은 날
    const { since, until } = kstRange('today', now);
    const saved = '2026-07-20T09:22:26.158Z';
    expect(saved >= since && saved < until).toBe(true);
  });
});
