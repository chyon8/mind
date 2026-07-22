// LLM 호출 비용 추적 (2026-07-22 — "어제 왜 4.93달러 나갔지"에 답을 못 한 것에서 시작).
//
// gate_log와 같은 결의 원장: 호출마다 fire-and-forget으로 rudy.llm_usage에 남긴다.
// 단가는 우리가 유지한다 — API 응답의 usage는 토큰 수일 뿐 달러가 아니다.
// 확인(2026-07-22, OpenAI 공식 가격표 developers.openai.com/api/docs/pricing):
//   gpt-4o $2.50/$10.00 (in/out, per 1M) · gpt-4o-mini $0.15/$0.60 · gpt-5.5 $5.00/$30.00
//   (캐시 입력 $0.50/1M).
//
// ⚠️ 단가를 모르는 모델(오타·모델 교체·env로 바꾼 값)은 0으로 속이지 않는다 — null을 반환해
//    "공짜"와 "단가 모름"을 구분한다. 조용히 0으로 새면 다음 "왜 이렇게 쌌지"가 또 터진다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const PRICE_PER_1M: Record<string, { in: number; out: number; cachedIn?: number }> = {
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-5.5': { in: 5.0, out: 30.0, cachedIn: 0.5 },
};

export type Usage = { promptTokens: number; completionTokens: number; cachedTokens: number };

export function estimateCost(model: string, u: Usage): number | null {
  const p = PRICE_PER_1M[model];
  if (!p) return null;
  const cached = Math.min(u.cachedTokens, u.promptTokens);
  const plain = u.promptTokens - cached;
  return (plain * p.in + cached * (p.cachedIn ?? p.in) + u.completionTokens * p.out) / 1_000_000;
}

function logUsage(
  supabase: SupabaseClient,
  callSite: string,
  model: string,
  u: Usage,
  ctx: { requestId: string; conversationId?: string },
): number | null {
  const cost = estimateCost(model, u);
  supabase
    .schema('rudy')
    .from('llm_usage')
    .insert({
      call_site: callSite,
      model,
      prompt_tokens: u.promptTokens,
      completion_tokens: u.completionTokens,
      cached_tokens: u.cachedTokens,
      cost_usd: cost,
      request_id: ctx.requestId,
      conversation_id: ctx.conversationId ?? null,
    })
    .then(undefined, (e: unknown) => console.warn('[llm_usage]', e));
  return cost;
}

// 한 응답(채팅 1턴 / 브리핑 1회) 동안 여러 콜의 비용을 모은다.
// unknown=true면 단가 모르는 모델이 섞였다는 뜻 — 화면에 "적어도 $X"로 구분해 보여줘야 한다.
export function costTracker(supabase: SupabaseClient, ctx: { requestId: string; conversationId?: string }) {
  let total = 0;
  let unknown = false;
  return {
    // callSite·model을 미리 채운 onUsage 콜백을 만들어준다 — complete()/chatStream()에 그대로 넘긴다.
    track: (callSite: string, model: string) => (u: Usage) => {
      const cost = logUsage(supabase, callSite, model, u, ctx);
      if (cost == null) unknown = true;
      else total += cost;
    },
    result: (): { usd: number | null; unknown: boolean } => ({
      usd: unknown && total === 0 ? null : total,
      unknown,
    }),
  };
}
