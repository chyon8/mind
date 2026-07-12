// 날짜 그룹핑·표시는 전부 기기 로컬 타임존 기준 (PLAN.md §3.2)
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// 타임라인 날짜 구분선: "7월 12일 토"
export function feedDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}`;
}

// 어젠다 섹션 헤더: 큰 숫자 + "7월 · 토요일"
export function agendaDateParts(iso: string): { day: string; sub: string } {
  const d = new Date(iso);
  return { day: String(d.getDate()), sub: `${d.getMonth() + 1}월 · ${WEEKDAYS[d.getDay()]}요일` };
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
