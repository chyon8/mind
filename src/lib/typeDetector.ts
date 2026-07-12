import type { FragmentType } from './types';

// PLAN.md §3.3 — 위에서부터 첫 매치. 오판별은 허용 (표시 방식만 바뀜).
// 웹 입력 페이지(web/index.html)는 이 파일의 로직을 그대로 복사해 쓴다 — 수정 시 양쪽 동기화.

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ['“', '”'], // “ ”
  ["'", "'"],
  ['‘', '’'], // ‘ ’
  ['「', '」'],
  ['『', '』'],
];

// — 출처 / - 출처 (출처 2~30자). 단독 한 줄이면 목록 글머리표일 가능성이 높아 제외.
const ATTRIBUTION = /^[—–-]\s?\S[^\n]{0,28}$/;

export function detectType(content: string, hasImage = false): FragmentType {
  if (hasImage) return 'image';

  const trimmed = content.trim();

  if (/^(https?:\/\/|www\.)\S+$/.test(trimmed)) return 'link';

  if (
    trimmed.length >= 2 &&
    QUOTE_PAIRS.some(([open, close]) => trimmed.startsWith(open) && trimmed.endsWith(close))
  ) {
    return 'quote';
  }

  const lines = trimmed.split('\n');
  if (lines.length >= 2 && ATTRIBUTION.test(lines[lines.length - 1].trim())) return 'quote';

  return 'text';
}
