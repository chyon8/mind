// Phase 0 완료 기준 "임베딩 모델 실측"용 디버그 스크립트. 앱 코드가 아니다 — 눈으로 보고 지우면 된다.
//   node scripts/check-embeddings.mjs "음악"
//   node scripts/check-embeddings.mjs "음악" --links   ← 링크 파편 중에서만 랭킹
// 쿼리 텍스트를 임베딩해서 저장된 파편들과 코사인 유사도로 랭킹, 상위 10개를 점수와 함께 출력한다.
// "음악" 쳤을 때 "피아노 배우기" 같은 파편이 위쪽에 뜨면 통과.

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
const linksOnly = process.argv.includes('--links');
if (!query) {
  console.error('사용법: node scripts/check-embeddings.mjs "검색어" [--links]');
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY) {
  console.error('환경변수 부족: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY 필요 (백필 때처럼 .env에 SERVICE_ROLE_KEY 임시로 넣어둘 것)');
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

// pgvector 컬럼은 postgrest를 거치면 "[0.01,-0.02,...]" 형태 문자열로 온다 — 숫자만이라 JSON.parse로 충분.
function parseVector(v) {
  return typeof v === 'string' ? JSON.parse(v) : v;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  const qVec = await embed(query);

  const { data: embeddings, error: e1 } = await supabase
    .schema('rudy').from('fragment_embeddings').select('fragment_id, embedding');
  if (e1) throw e1;
  if (embeddings.length === 0) {
    console.error('rudy.fragment_embeddings가 비어있다 — 백필 먼저 돌렸는지 확인');
    process.exit(1);
  }

  const { data: frags, error: e2 } = await supabase
    .from('fragments').select('id, type, content, link_title')
    .in('id', embeddings.map((e) => e.fragment_id));
  if (e2) throw e2;
  const byId = new Map(frags.map((f) => [f.id, f]));

  const ranked = embeddings
    .filter((e) => !linksOnly || byId.get(e.fragment_id)?.type === 'link')
    .map((e) => ({ id: e.fragment_id, score: cosine(qVec, parseVector(e.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  console.log(`"${query}" 와(과) 유사도 상위 10개${linksOnly ? ' (링크만)' : ''}:\n`);
  for (const r of ranked) {
    const f = byId.get(r.id);
    const label = f?.type === 'link' ? (f.link_title ?? f.content) : f?.content ?? '(파편 없음)';
    console.log(`${r.score.toFixed(3)}  [${f?.type ?? '?'}]  ${label.slice(0, 60)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
