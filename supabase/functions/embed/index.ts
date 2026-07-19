// 파편 저장/수정 시 자동 호출되는 임베딩 웹훅 (RUDY-BUILD.md Phase 0-3).
// public.fragments의 Insert/Update Database Webhook → 이 함수.
// 유저는 아무것도 기다리지 않는다 (비동기).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { embed } from '../_shared/openai.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// 링크 파편의 content는 URL이라 임베딩하면 유령 파편 → 제목·노트를 쓴다 (RUDY.md §3-2).
// merged_from 조각의 content도 합쳐 신호를 살린다.
function embedText(f: Record<string, any>): string {
  const merged = (f.merged_from ?? []).map((p: any) => p?.content).filter(Boolean).join('\n');
  // 링크는 제목 + 설명글(둘 다 신호). 나머지는 content. note·merged는 공통.
  const head = f.type === 'link' ? [f.link_title ?? f.content, f.link_description] : [f.content];
  return [...head, f.note, merged].filter(Boolean).join('\n').trim();
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  // Database Webhook payload: { type, record, old_record, ... }
  const { record: f } = await req.json();
  if (!f?.id) return new Response('no record', { status: 400 });

  const text = embedText(f);
  if (!text) return new Response('empty', { status: 200 }); // 이미지-only 등 임베딩할 게 없음

  const hash = await sha256(text);
  // 내용이 안 바뀌었으면 스킵 — touch/touch_count 등으로 오는 update 웹훅 대량 방지
  const { data: existing } = await supabase
    .schema('rudy').from('fragment_embeddings')
    .select('source_hash').eq('fragment_id', f.id).maybeSingle();
  if (existing?.source_hash === hash) return new Response('unchanged', { status: 200 });

  const embedding = await embed(text);

  const { error } = await supabase.schema('rudy').from('fragment_embeddings').upsert({
    fragment_id: f.id, embedding, source_hash: hash, embedded_at: new Date().toISOString(),
  });
  if (error) return new Response(error.message, { status: 500 });
  return new Response('ok', { status: 200 });
});
