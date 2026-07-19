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
