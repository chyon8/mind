// 데일리 뷰가 과거 날짜를 보던 중이어도, 던진 직후에는 오늘로 이동해서
// 방금 던진 파편이 보이게 하기 위한 1회성 신호 (PLAN.md §6.1)
let thrown = false;

export function markThrown(): void {
  thrown = true;
}

export function consumeThrown(): boolean {
  const t = thrown;
  thrown = false;
  return t;
}
