// LLM 응답 비용 표시 (2026-07-22, _shared/usage.ts와 짝). 채팅·발견 두 화면이 같이 쓴다.
// null = 단가를 모르는 모델이 섞였다는 뜻 — 0으로 감추지 않고 그대로 드러낸다.
export function formatCost(usd: number | null): string {
  if (usd == null) return '단가 미상';
  if (usd === 0) return '$0';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
