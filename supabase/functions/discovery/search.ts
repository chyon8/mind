// Exa 검색 래퍼 (RUDY-DISCOVERY §7 검색 절반).
//
// REST를 직접 친다 — exa-js SDK를 안 쓴다(openai.ts가 SDK 없이 fetch를 쓰는 것과 같은 판단,
// Deno Edge Function에 npm 의존을 안 늘린다). 실측(2026-07-21):
//   POST https://api.exa.ai/search · header x-api-key · body {query,type,numResults,contents}
//   응답 results[]{id,title,url,publishedDate,author,highlights,image,favicon}
//   costDollars ~0.007/검색 → 하루 8검색 월 ~$1.7. 무시.
//
// highlights를 받는 이유: 본문 발췌가 손에 있어야 모델이 "볼 가치 있나"를 직접 판단한다.
// gpt-4o가 제목만 보고 버리던 문제(§8)가 여기서 풀린다.

const EXA_KEY = Deno.env.get('EXA_API_KEY')!;

export type ExaResult = {
  title: string | null;
  url: string;
  publishedDate: string | null;
  author: string | null;
  highlights: string[];
};

export async function exaSearch(query: string, numResults = 5): Promise<ExaResult[]> {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': EXA_KEY, 'Content-Type': 'application/json' },
    // type:auto = 관련성·속도 균형(유저 기본 선택). highlights만 = 토큰 예측 가능.
    body: JSON.stringify({ query, type: 'auto', numResults, contents: { highlights: true } }),
  });
  if (!res.ok) throw new Error(`exa ${res.status}: ${await res.text()}`);
  const { results } = (await res.json()) as { results?: Record<string, unknown>[] };
  return (results ?? []).map((r) => ({
    title: (r.title as string) ?? null,
    url: r.url as string,
    publishedDate: (r.publishedDate as string) ?? null,
    author: (r.author as string) ?? null,
    highlights: (r.highlights as string[]) ?? [],
  }));
}
