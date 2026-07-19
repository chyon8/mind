// 스트림 청크를 줄 단위로 재조립한다. 채팅 스트리밍(NDJSON)의 심장.
//
// 순수 모듈로 뗀 이유: "답이 나오다가 잘린다"의 첫 번째 원인이 바로 이 로직의
// 마지막 버퍼 flush 누락이었다 (2026-07-19). UI에 섞여 있으면 테스트를 못 해서
// 같은 부류의 버그가 또 숨는다 — 여기 두고 jest로 잘림 시나리오를 못 박는다.
export function lineFeeder(onLine: (line: string) => void) {
  let buffer = '';
  return {
    // 청크가 줄 가운데서 잘려도 마지막 조각을 버퍼에 남겨 다음 청크와 붙인다
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) onLine(line);
    },
    // ⚠️ 스트림이 끝나면 반드시 부른다. 마지막 줄이 개행 없이 닫히면
    // 버퍼에 남아 있다 — 안 흘리면 답변 끝이 통째로 사라진다.
    end() {
      if (buffer.trim()) onLine(buffer);
      buffer = '';
    },
  };
}
