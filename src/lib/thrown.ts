// 데일리 뷰가 과거 날짜를 보던 중이어도, 던진 직후에는 오늘로 이동해서
// 방금 던진 파편이 보이게 하기 위한 1회성 신호 (PLAN.md §6.1)
let thrown = false;
const listeners = new Set<() => void>();

export function markThrown(): void {
  thrown = true;
  for (const l of listeners) l();
}

export function consumeThrown(): boolean {
  const t = thrown;
  thrown = false;
  return t;
}

// 공유 저장은 화면이 이미 떠 있는 상태에서 일어난다 — 포커스가 바뀌지 않으니
// useFocusEffect가 돌지 않는다. 그래서 던져진 즉시 목록에 직접 알린다.
export function onThrown(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
