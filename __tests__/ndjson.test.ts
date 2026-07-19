import { lineFeeder } from '../src/lib/ndjson';

function collect() {
  const lines: string[] = [];
  const feeder = lineFeeder((l) => lines.push(l));
  return { lines, feeder };
}

describe('lineFeeder', () => {
  test('한 청크에 여러 줄', () => {
    const { lines, feeder } = collect();
    feeder.push('{"a":1}\n{"b":2}\n');
    feeder.end();
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test('줄 가운데서 잘린 청크는 다음 청크와 붙는다', () => {
    const { lines, feeder } = collect();
    feeder.push('{"t":"d","c":"안녕');
    feeder.push('하세요"}\n');
    feeder.end();
    expect(lines).toEqual(['{"t":"d","c":"안녕하세요"}']);
  });

  // 회귀 테스트 — "답이 나오다가 잘린다" (2026-07-19).
  // 마지막 줄이 개행 없이 닫히면 end()가 흘려야 한다.
  test('개행 없이 끝난 마지막 줄도 나온다', () => {
    const { lines, feeder } = collect();
    feeder.push('{"t":"d","c":"앞부분"}\n{"t":"done","saved":true}');
    feeder.end();
    expect(lines).toEqual(['{"t":"d","c":"앞부분"}', '{"t":"done","saved":true}']);
  });

  test('빈 줄은 건너뛴다', () => {
    const { lines, feeder } = collect();
    feeder.push('\n\n{"a":1}\n\n');
    feeder.end();
    expect(lines).toEqual(['{"a":1}']);
  });

  test('end 후 버퍼는 비워진다 (이중 호출 안전)', () => {
    const { lines, feeder } = collect();
    feeder.push('{"a":1}');
    feeder.end();
    feeder.end();
    expect(lines).toEqual(['{"a":1}']);
  });
});
