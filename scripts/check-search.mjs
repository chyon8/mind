// 하이브리드 검색 RPC(rudy.search_fragments)를 앱 없이 직접 호출해 검증한다.
//   node scripts/check-search.mjs "음악"            ← 전체
//   node scripts/check-search.mjs "음악" link        ← 링크만 (text|link|image|quote)
// RPC가 없으면 "function ... does not exist" 에러가 뜬다 → rudy-search.sql 재실행 필요.
// 결과 개수가 많으면 RPC는 정상 — 앱에서 적게 나오는 건 칩 필터가 켜진 것.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const EMBED_MODEL = 'text-embedding-3-large';

try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없으면 순수 env로 */ }

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI_API_KEY;

const query = process.argv[2];
const typeFilter = process.argv[3] ?? null;
if (!query) {
  console.error('사용법: node scripts/check-search.mjs "검색어" [text|link|image|quote]');
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY) {
  console.error('환경변수 부족: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY 필요');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  return data[0].embedding;
}

async function main() {
  const qEmbed = await embed(query);
  const { data: hits, error } = await supabase.schema('rudy').rpc('search_fragments', {
    q_text: query,
    q_embed: qEmbed,
    match_count: 30,
    type_filter: typeFilter,
  });
  if (error) {
    console.error('RPC 에러:', error.message);
    if (/does not exist|could not find/i.test(error.message)) {
      console.error('→ rudy-search.sql을 SQL Editor에서 재실행해야 한다 (4-arg RPC 없음).');
    }
    process.exit(1);
  }

  console.log(`"${query}"${typeFilter ? ` [${typeFilter}]` : ' [전체]'} → ${hits.length}개\n`);
  const { data: frags } = await supabase
    .from('fragments').select('id, type, content, link_title')
    .in('id', hits.map((h) => h.id));
  const byId = new Map((frags ?? []).map((f) => [f.id, f]));
  for (const h of hits) {
    const f = byId.get(h.id);
    const label = f?.type === 'link' ? (f.link_title ?? f.content) : f?.content ?? '?';
    console.log(`${h.score.toFixed(3)} [${h.matched_by}] [${f?.type}] ${label.slice(0, 50)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
