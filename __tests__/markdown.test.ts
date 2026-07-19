import { parseInline, parseMarkdown } from '../src/lib/markdown';

describe('parseInline', () => {
  test('굵게·코드·링크가 섞인 줄', () => {
    expect(parseInline('**중요**한 건 `코드`와 [제목](mind://fragment/abc)이다')).toEqual([
      { t: 'bold', text: '중요' },
      { t: 'text', text: '한 건 ' },
      { t: 'code', text: '코드' },
      { t: 'text', text: '와 ' },
      { t: 'link', text: '제목', href: 'mind://fragment/abc' },
      { t: 'text', text: '이다' },
    ]);
  });

  test('마크업 없는 평문은 통짜 텍스트', () => {
    expect(parseInline('그냥 문장')).toEqual([{ t: 'text', text: '그냥 문장' }]);
  });

  test('안 닫힌 굵게는 텍스트로 남는다 (스트리밍 중간)', () => {
    expect(parseInline('아직 **안 닫힘')).toEqual([{ t: 'text', text: '아직 **안 닫힘' }]);
  });

  test('한글 제목 링크 (『』 포함)', () => {
    expect(parseInline('[『음성으로 녹음』](mind://fragment/x1)')).toEqual([
      { t: 'link', text: '『음성으로 녹음』', href: 'mind://fragment/x1' },
    ]);
  });
});

describe('parseMarkdown', () => {
  test('문단·목록·헤딩 구분', () => {
    const blocks = parseMarkdown('첫 문단\n\n- 하나\n- 둘\n\n## 제목\n다음 문단');
    expect(blocks.map((b) => b.t)).toEqual(['p', 'li', 'li', 'h', 'p']);
  });

  test('번호 목록은 원래 번호를 유지한다', () => {
    const blocks = parseMarkdown('1. 하나\n3. 셋');
    expect(blocks).toMatchObject([
      { t: 'li', ordered: true, index: 1 },
      { t: 'li', ordered: true, index: 3 },
    ]);
  });

  test('굵게로 시작하는 줄은 목록이 아니다', () => {
    const blocks = parseMarkdown('**요점**만 말하면');
    expect(blocks).toMatchObject([{ t: 'p' }]);
  });

  test('코드 펜스', () => {
    const blocks = parseMarkdown('앞\n```\nconst a = 1;\n```\n뒤');
    expect(blocks).toMatchObject([{ t: 'p' }, { t: 'codeblock', text: 'const a = 1;' }, { t: 'p' }]);
  });

  test('안 닫힌 펜스도 죽지 않는다 (스트리밍 중간)', () => {
    const blocks = parseMarkdown('앞\n```\n미완성');
    expect(blocks).toMatchObject([{ t: 'p' }, { t: 'codeblock', text: '미완성' }]);
  });

  test('문단 내 줄바꿈은 한 문단으로 합친다', () => {
    const blocks = parseMarkdown('첫 줄\n둘째 줄');
    expect(blocks).toHaveLength(1);
  });
});
