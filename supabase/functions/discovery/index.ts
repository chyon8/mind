// 발견 브리핑 엔드포인트 (RUDY.md §4-E · §10-7).
//
// 재료 → 각도(gpt-5.5) → Exa 검색 → 조립(gpt-5.5)을 NDJSON으로 스트리밍한다.
// 30~60초를 못 줄이는 대신 단계(status)와 토큰(d)이 흘러나와 앱이 진행을 보여준다.
// 무저장 원칙(§2-1): 브리핑은 원장(utterances)에만 남는다. 파편은 안 건드린다(§2-3).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { streamBrief } from './brief.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const line = (o: unknown) => new TextEncoder().encode(`${JSON.stringify(o)}\n`);

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of streamBrief(supabase)) {
          controller.enqueue(line(ev));
        }
      } catch (e) {
        console.error('[discovery]', e);
        controller.enqueue(line({ t: 'error', message: String(e) }));
      } finally {
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 */
        }
      }
    },
  });

  return new Response(stream, { headers: { ...cors, 'Content-Type': 'application/x-ndjson' } });
});
