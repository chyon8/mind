// 기존 파편 전체 임베딩 백필 (RUDY-BUILD.md Phase 0-5). 1회 실행.
//   node scripts/backfill-embeddings.mjs
// 필요한 env (없으면 .env에서 읽음, service role은 .env에 없으니 직접 넣어야 함):
//   SUPABASE_URL             (= .env의 EXPO_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY  ← 대시보드 Settings > API > service_role. .env에 임시로 추가하거나 export
//   OPENAI_API_KEY           (= .env의 OPEN_AI_API_KEY)
//
// embedText·해시는 supabase/functions/embed/index.ts와 반드시 동일해야 한다 —
// 그래야 백필한 행이 이후 update 웹훅에서 불필요하게 재임베딩되지 않는다.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const EMBED_MODEL = 'text-embedding-3-large';
const BATCH = 50;

// .env를 process.env에 얹는다 (이미 있는 값은 유지)
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없으면 순수 env로 */ }

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY) {
  console.error('환경변수 부족: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY 필요');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function embedText(f) {
  const merged = (f.merged_from ?? []).map((p) => p?.content).filter(Boolean).join('\n');
  // 링크는 제목 + 설명글(둘 다 신호). embed/index.ts와 반드시 동일해야 한다 (해시 일치).
  const head = f.type === 'link' ? [f.link_title ?? f.content, f.link_description] : [f.content];
  return [...head, f.note, merged].filter(Boolean).join('\n').trim();
}

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedBatch(inputs) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  return data.sort((a, b) => a.index - b.index).map((d) => d.embedding); // 순서 보존
}

async function main() {
  const { data: frags, error } = await supabase
    .from('fragments')
    .select('id, type, content, link_title, link_description, note, merged_from');
  if (error) throw error;

  const { data: done, error: e2 } = await supabase
    .schema('rudy').from('fragment_embeddings').select('fragment_id');
  if (e2) throw e2;
  const doneSet = new Set(done.map((d) => d.fragment_id));

  // 임베딩할 텍스트가 있고 아직 임베딩 안 된 것만
  const todo = frags
    .filter((f) => !doneSet.has(f.id))
    .map((f) => ({ id: f.id, text: embedText(f) }))
    .filter((x) => x.text);

  console.log(`대상 ${todo.length}개 / 전체 ${frags.length}개 (이미 됨 ${doneSet.size})`);

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const embeddings = await embedBatch(chunk.map((c) => c.text));
    const rows = chunk.map((c, j) => ({
      fragment_id: c.id,
      embedding: embeddings[j],
      source_hash: sha256(c.text),
      embedded_at: new Date().toISOString(),
    }));
    const { error: upErr } = await supabase.schema('rudy').from('fragment_embeddings').upsert(rows);
    if (upErr) throw upErr;
    console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
    await sleep(200); // rate limit 여유
  }
  console.log('완료.');
}

main().catch((e) => { console.error(e); process.exit(1); });
