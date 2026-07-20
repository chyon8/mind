// 시간대 (RUDY.md §4-C2).
//
// ⚠️ 서버는 UTC, 유저는 KST(+9). 이 차이를 무시하면 **KST 00:00~08:59 사이에 루디가
//    어제를 오늘로 안다** — UTC 날짜가 아직 안 넘어갔기 때문. 밤에 저장하는 사람에겐
//    "오늘 뭐 저장했지"가 매번 틀린 답을 받는다는 뜻이다 (2026-07-20 실사용에서 터짐).
//    유저가 한 명이므로 시간대는 상수로 고정한다. 서머타임 없음.

const KST = 9 * 3_600_000;

/** KST 기준 오늘 날짜 (YYYY-MM-DD). 프롬프트에 주입하는 "오늘"은 반드시 이걸 쓴다. */
export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + KST).toISOString().slice(0, 10);
}

/**
 * timestamptz → 유저가 보는 날짜 (YYYY-MM-DD).
 *
 * ⚠️ **범위만 KST로 자르고 표시를 UTC로 두면 안 된다.** 실제로 그렇게 했다가,
 * "오늘 7개" 헤더 아래 `날짜: 2026-07-19`인 줄이 섞여서 모델이 6개라고 답했다 (2026-07-20).
 * 모델이 틀린 게 아니라 준 데이터가 모순이었다. 근거·축·질문 — 파편 날짜를 찍는 곳은 전부 이걸 쓴다.
 */
export function kstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);
}

export type Period = 'today' | 'yesterday' | 'week' | 'month';

/**
 * 기간 → UTC 경계. **KST 자정 기준**으로 자른다.
 * until은 열린 끝(미만)이라 `gte(since)` + `lt(until)`로 쓴다.
 */
export function kstRange(period: Period, now = new Date()): { since: string; until: string } {
  const midnight = (offset: number) => {
    const d = new Date(`${kstToday(now)}T00:00:00+09:00`);
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };
  const tomorrow = midnight(1);
  switch (period) {
    case 'today':
      return { since: midnight(0), until: tomorrow };
    case 'yesterday':
      return { since: midnight(-1), until: midnight(0) };
    case 'week':
      return { since: midnight(-7), until: tomorrow };
    case 'month':
      return { since: midnight(-30), until: tomorrow };
  }
}

export const PERIOD_LABEL: Record<Period, string> = {
  today: '오늘',
  yesterday: '어제',
  week: '최근 7일',
  month: '최근 30일',
};
