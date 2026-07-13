import type { FragmentType } from './types';

// PLAN.md §3.3 — 위에서부터 첫 매치. 오판별은 허용 (표시 방식만 바뀜).
// 웹 입력 페이지(web/index.html)는 이 파일의 로직을 그대로 복사해 쓴다 — 수정 시 양쪽 동기화.

// 여는 인용부호 하나만 있어도 인용으로 본다 — 닫을 때까지 기다리지 않는다.
const QUOTE_OPENERS = ['"', '“', "'", '‘', '「', '『'];

// — 출처 / - 출처 (출처 2~30자). 단독 한 줄이면 목록 글머리표일 가능성이 높아 제외.
const ATTRIBUTION = /^[—–-]\s?\S[^\n]{0,28}$/;

// 느슨한 판별 — 타이핑 도중에도 즉시 반응한다. 오판별은 허용 (표시 방식만 바뀜).
export function detectType(content: string, hasImage = false): FragmentType {
  if (hasImage) return 'image';

  const trimmed = content.trim();

  // 공백 없는 한 덩어리가 URL로 시작하면 link — "www." 만 쳐도 잡힌다.
  if (/^(https?:\/\/|www\.)\S*$/.test(trimmed)) return 'link';

  if (QUOTE_OPENERS.some((open) => trimmed.startsWith(open))) return 'quote';

  const lines = trimmed.split('\n');
  if (lines.length >= 2 && ATTRIBUTION.test(lines[lines.length - 1].trim())) return 'quote';

  return 'text';
}
