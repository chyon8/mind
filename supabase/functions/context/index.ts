// 맥락 꺼내기 (2026-08-14) — 맥락 카드 전량 + 요청 한 줄 → 요약 한 덩어리.
//
// 결과물의 목적지는 **다른 LLM의 대화창**이다. 앱 안에서 읽히는 답이 아니라
// 유저가 복사해서 붙여넣을 텍스트라, 말 걸기·인사말 없이 본문만 낸다.
//
// ⚠️ 파편·발견·임베딩을 전혀 안 건드린다 (독립 공간, supabase/context.sql).
//    검색도 안 한다 — 카드가 수십 개라 전량을 그대로 넘기는 게 제일 단순하고 정확하다.
//
// 스트리밍 안 한다. 답이 한 덩어리로 나와 복사되는 물건이라 토큰이 흘러도 할 일이 없다.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CHAT_MODEL, complete } from '../_shared/openai.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

// 인물평 금지가 이 프롬프트의 핵심이다. 맥락을 꺼내는 목적이 "나를 규정하는 것"이 아니라
// "지금 필요한 사실을 상대 모델에게 넘기는 것"이라, 성격 요약이 끼면 정확히 반대로 간다.
const SYSTEM = `너는 사용자가 직접 써 넣은 "맥락 카드"를 읽고 요청에 맞게 정리하는 역할이다.
결과물은 사용자가 **다른 AI 대화창에 그대로 붙여넣을 텍스트**다. 사용자에게 말을 거는 게 아니다.

규칙:
- 카드에 없는 사실을 지어내지 마라. 카드에 없으면 안 쓴다. 추측으로 채우지 마라.
- 성격·기질·가치관을 평가하거나 인물평을 쓰지 마라. 사실과 기록만 쓴다.
- 요청 범위 밖의 카드는 통째로 뺀다. 전부 담으라는 요청이 아니면 전부 담지 않는다.
- 요청이 원하는 형태를 따른다 (이력서면 이력서 형식, 소개면 소개 형식).
- 한국어. 마크다운. 인사말·맺음말·"도움이 되셨으면" 같은 것 없이 본문만.
- 맨 마지막 줄에 근거를 한 줄 남긴다: \`— 맥락 카드 N장 중 M장 기준 · YYYY-MM-DD\``;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { request } = await req.json();
    if (!request || typeof request !== 'string' || !request.trim()) {
      return json({ error: '요청이 비어 있다' }, 400);
    }

    const { data: cards, error } = await supabase
      .from('context_cards')
      .select('title, body')
      .order('created_at');
    if (error) throw error;
    if (!cards || cards.length === 0) {
      return json({ error: '맥락 카드가 하나도 없다 — 먼저 채워야 한다' }, 400);
    }

    const block = cards
      .map((c, i) => `### 카드 ${i + 1} — ${c.title || '(제목 없음)'}\n${c.body || '(비어 있음)'}`)
      .join('\n\n');
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

    const text = await complete(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `오늘: ${today}\n맥락 카드 ${cards.length}장:\n\n${block}\n\n---\n요청: ${request.trim()}`,
        },
      ],
      CHAT_MODEL,
      undefined,
      { call_site: 'context_summon' },
    );

    return json({ text });
  } catch (e) {
    console.error('[context]', e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
