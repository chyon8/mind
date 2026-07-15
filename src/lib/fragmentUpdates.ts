// 상세 화면에서 수정이 끝난 뒤, 이미 마운트된 목록 화면도 최신 데이터를 다시 읽도록 알린다.
// 저장 완료 뒤에만 발행하므로 목록 조회가 이전 DB 상태를 읽는 경합을 피할 수 있다.
const listeners = new Set<() => void>();

export function markFragmentUpdated(): void {
  for (const listener of listeners) listener();
}

export function onFragmentUpdated(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
