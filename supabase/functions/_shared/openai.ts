// OpenAI 임베딩 호출 — embed(웹훅) · embed-query · chat이 공유한다.
// 키는 Edge Function 시크릿. 앱에 절대 내장하지 않는다 (RUDY-BUILD.md 0).

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY')!;
export const EMBED_MODEL = 'text-embedding-3-large'; // 3072차원 (유저 지시: 최상 퀄리티)

// 단일 텍스트 → 임베딩 벡터. 빈 문자열은 호출 전에 걸러야 한다.
export async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  return data[0].embedding as number[];
}

// 여러 텍스트를 한 번에 임베딩한다 (다중 질의 검색용 — 왕복 1회로 끝낸다).
export async function embedMany(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  // API가 순서를 보장하지만 index로 정렬해 확실히 맞춘다
  return (data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// 모델 ID는 env로 뺀다 — 지연·품질 보고 바꿀 때 코드를 안 건드리게 (RUDY-BUILD.md 0).
export const CHAT_MODEL = Deno.env.get('OPENAI_CHAT_MODEL') ?? 'gpt-4o';
// 질의 재작성 같은 짧은 보조 작업용. 본 답변 모델과 분리한다 — 여기 지연이 첫 토큰을 늦춘다.
export const FAST_MODEL = Deno.env.get('OPENAI_FAST_MODEL') ?? 'gpt-4o-mini';
// 발견 각도 결정용 — 채팅과 분리한다. 실측(2026-07-21, check-angles): gpt-4o는 각도가
// 막연한 리스티클 미끼가 되고 gpt-5.5라야 파편을 겹치고 합쳐 손 퀄에 근접한다. 하루 1회라 비용 무시.
export const DISCOVERY_MODEL = Deno.env.get('OPENAI_DISCOVERY_MODEL') ?? 'gpt-5.5';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// 스트리밍 없는 단발 호출 (보조 작업용).
export async function complete(messages: ChatMessage[], model = FAST_MODEL): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    // gpt-5 계열은 temperature 고정(1)만 받는다 — 그 외 모델만 0으로 재현성 확보
    body: JSON.stringify({ model, messages, ...(model.startsWith('gpt-5') ? {} : { temperature: 0 }) }),
  });
  if (!res.ok) throw new Error(`openai chat ${res.status}: ${await res.text()}`);
  const { choices } = await res.json();
  return (choices?.[0]?.message?.content ?? '').trim();
}

// 채팅 응답을 토큰 단위로 흘린다. 통째로 기다리면 "바로바로 알아듣는다"(§4-C1)가 죽는다.
// OpenAI SSE(`data: {...}` 줄 + `[DONE]`)를 델타 문자열로만 풀어 넘긴다 — SSE 파싱을
// 여기 한 곳에 가둬서 호출부는 텍스트 조각만 다루면 되게.
export async function* chatStream(
  messages: ChatMessage[],
  model = CHAT_MODEL,
): AsyncGenerator<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true, messages }),
  });
  if (!res.ok || !res.body) throw new Error(`openai chat ${res.status}: ${await res.text()}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  // 한 줄을 델타로 푼다. 끝(`[DONE]`)이면 null.
  function parse(line: string): string | null | undefined {
    if (!line.startsWith('data: ')) return undefined;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') return null;
    return JSON.parse(payload).choices?.[0]?.delta?.content ?? undefined;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    // 마지막 조각은 잘린 줄일 수 있으므로 버퍼에 남긴다
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const delta = parse(line);
      if (delta === null) return;
      if (delta) yield delta;
    }
  }

  // ⚠️ 남은 버퍼를 흘리지 않으면 답변 끝이 잘린다.
  // OpenAI가 마지막 줄을 개행 없이 닫으면 그 줄이 통째로 버려진다 — "나오다가 마는" 증상의 원인.
  const tail = parse(buffer.trim());
  if (tail) yield tail;
}
