// 일회성 버그 수정: backfill-link-desc.mjs가 og:description을 그대로 저장하던 시절,
// 설명 없는 유튜브 영상은 유튜브의 사이트 홍보 문구("좋아하는 동영상과 음악을...")로
// link_description이 오염됐다. 이 스크립트는 유튜브 링크만 다시 훑어 실제 재생 데이터
// (shortDescription)로 덮어쓴다 — null 여부와 무관하게 전부 재계산 (기존 backfill과 달리
// 이미 값이 있어도 건드린다. 그게 이 스크립트의 존재 이유).
//   node scripts/fix-youtube-descriptions.mjs
// link_description을 update하면 embed 웹훅이 자동 재임베딩 (backfill-embeddings.mjs 재실행 불필요).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없으면 순수 env로 */ }

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('환경변수 부족: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const TIMEOUT_MS = 8000;

function isYoutubeUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com');
  } catch { return false; }
}

function extractYoutubeDescription(html) {
  const m = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`) || null; } catch { return null; }
}

async function fetchYoutubeDesc(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return extractYoutubeDescription(await res.text());
  } finally { clearTimeout(timer); }
}

async function main() {
  const { data: links, error } = await supabase
    .from('fragments').select('id, content')
    .eq('type', 'link');
  if (error) throw error;

  const youtubeLinks = links.filter((fr) => isYoutubeUrl(fr.content));
  console.log(`유튜브 링크 ${youtubeLinks.length}개 재계산`);

  let ok = 0;
  for (const fr of youtubeLinks) {
    let desc = null;
    try { desc = await fetchYoutubeDesc(fr.content); } catch { desc = null; }
    const { error: upErr } = await supabase
      .from('fragments').update({ link_description: desc }).eq('id', fr.id);
    if (upErr) { console.error(`  실패 ${fr.id}: ${upErr.message}`); continue; }
    if (desc) ok++;
    process.stdout.write(desc ? '.' : 'x'); // . = 실제 설명 확보, x = 진짜로 설명 없음/접근 실패
  }
  console.log(`\n완료. 실제 설명 확보 ${ok}/${youtubeLinks.length} (나머지는 진짜 무설명 영상).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
