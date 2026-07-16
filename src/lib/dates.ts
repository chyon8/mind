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

export function getTimeBand(iso: string): string {
  const h = new Date(iso).getHours();
  if (h >= 6 && h < 12) return '아침';
  if (h >= 12 && h < 18) return '오후';
  if (h >= 18 && h < 24) return '저녁';
  return '밤';
}

// ── 데일리 뷰 주간 계산 (일요일 시작, 로컬 타임존)

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x;
}

export function addMonths(d: Date, months: number): Date {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

// 월 그리드는 항상 6행 — 달마다 높이가 출렁이면 스냅이 흔들린다.
// 앞뒤로 이웃 달의 날짜가 딸려 들어오지만 그건 달력의 정상 동작이다.
export function monthWeekStarts(d: Date): Date[] {
  const first = startOfWeek(startOfMonth(d));
  return Array.from({ length: 6 }, (_, i) => addDays(first, 7 * i));
}

// "7월"
export function monthLabel(d: Date): string {
  return `${d.getMonth() + 1}월`;
}

export const WEEKDAY_LABELS = WEEKDAYS;

// 날짜 입력값(YYYY-MM-DD) — toISOString은 UTC라 로컬 자정 근처에서 날짜가 밀릴 수 있다.
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// toDateKey의 역변환 — new Date("YYYY-MM-DD")는 UTC 자정으로 파싱되어 같은 문제가 생긴다.
export function parseDateKey(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
