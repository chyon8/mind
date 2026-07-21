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

// Supabase Edge의 백그라운드 태스크 — 요청이 끝나도(클라 끊겨도) 이 프로미스가 끝날 때까지 격리를 산다.
const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // ⚠️ 클라가 끊겨도(앱 종료·화면 이탈) streamBrief를 **끝까지** 돌려 원장에 저장한다.
  // 그래서 "생성 중 나가면 유실"이 없다. enqueue만 클라가 살아 있을 때 하고, 루프는 계속 돈다.
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));

  const stream = new ReadableStream({
    async start(controller) {
      let clientGone = false;
      const push = (o: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(line(o));
        } catch {
          clientGone = true; // 클라 끊김 — 이후로는 안 보내지만 생성은 계속
        }
      };
      try {
        for await (const ev of streamBrief(supabase)) push(ev);
      } catch (e) {
        console.error('[discovery]', e);
        push({ t: 'error', message: String(e) });
      } finally {
        if (!clientGone) {
          try {
            controller.close();
          } catch { /* 이미 닫힘 */ }
        }
        finish();
      }
    },
  });

  rt?.waitUntil?.(done); // 클라가 끊겨도 저장까지 끝나게 격리 유지
  return new Response(stream, { headers: { ...cors, 'Content-Type': 'application/x-ndjson' } });
});
