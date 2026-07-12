import { detectType } from '../src/lib/typeDetector';

describe('detectType — PLAN.md §3.3 규칙 표', () => {
  test('이미지 첨부는 내용과 무관하게 image (규칙 1이 최우선)', () => {
    expect(detectType('https://example.com', true)).toBe('image');
    expect(detectType('', true)).toBe('image');
  });

  test('전체가 URL 하나면 link', () => {
    expect(detectType('https://example.com/a?b=1')).toBe('link');
    expect(detectType('http://naver.com')).toBe('link');
    expect(detectType('www.youtube.com/watch?v=x')).toBe('link');
    expect(detectType('  https://example.com  ')).toBe('link'); // trim 후 판별
  });

  test('URL + 다른 텍스트가 섞이면 text', () => {
    expect(detectType('https://example.com 이거 봐라')).toBe('text');
    expect(detectType('이거 봐라 https://example.com')).toBe('text');
    expect(detectType('https://example.com\nhttps://example.org')).toBe('text');
  });

  test('인용부호 쌍으로 감싸면 quote', () => {
    expect(detectType('"삶은 고통이다"')).toBe('quote');
    expect(detectType('“스마트 쿼트도 인정”')).toBe('quote');
    expect(detectType("'작은따옴표'")).toBe('quote');
    expect(detectType('「일본식 인용」')).toBe('quote');
    expect(detectType('『겹낫표』')).toBe('quote');
  });

  test('짝이 안 맞는 인용부호는 text', () => {
    expect(detectType('"열기만 하고')).toBe('text');
    expect(detectType('닫기만"')).toBe('text');
  });

  test('마지막 줄이 — 출처 형태면 quote (본문이 위에 있을 때만)', () => {
    expect(detectType('신은 죽었다\n— 니체')).toBe('quote');
    expect(detectType('신은 죽었다\n- 니체')).toBe('quote');
    expect(detectType('긴 문장이\n여러 줄\n– 어떤 책, 12쪽')).toBe('quote');
  });

  test('단독 한 줄 "- xxx"는 목록으로 보고 text', () => {
    expect(detectType('- 우유 사기')).toBe('text');
  });

  test('출처가 30자를 넘으면 text', () => {
    expect(detectType(`문장\n— ${'가'.repeat(31)}`)).toBe('text');
  });

  test('그 외 전부 text', () => {
    expect(detectType('그냥 떠오른 생각')).toBe('text');
    expect(detectType('')).toBe('text');
    expect(detectType('여러 줄\n메모')).toBe('text');
  });
});
