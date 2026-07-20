// 늦은 의도(F1) 상태를 앱 없이 본다 — 지금 뭘 물을 참인지, 뭘 받아냈는지.
//   node scripts/check-intent.mjs
//
// 테이블이 없으면 "relation ... does not exist" → supabase/rudy-evidence.sql 실행 필요.

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

const label = (f) => ((f?.type === 'link' ? f.link_title ?? f.content : f?.content) ?? '?')
  .replace(/\s+/g, ' ').slice(0, 56);

async function main() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const { data: questions, error } = await supabase
    .schema('rudy').from('utterances')
    .select('id, created_at, item_ids, user_response, responded_at')
    .eq('kind', 'question').order('created_at', { ascending: false }).limit(10);
  if (error) {
    console.error('원장 조회 실패:', error.message);
    process.exit(1);
  }
  const askedToday = questions.filter((q) => new Date(q.created_at) >= dayStart).length;
  console.log(`오늘 물은 횟수: ${askedToday} / 1 ${askedToday ? '→ 예산 소진, 오늘은 더 안 묻는다' : '→ 다음 대화에서 하나 묻는다'}`);

  const { data: evidence, error: eErr } = await supabase
    .schema('rudy').from('evidence')
    .select('created_at, stated_text, related_item_ids')
    .order('created_at', { ascending: false }).limit(10);
  if (eErr) {
    console.error('\nevidence 조회 실패:', eErr.message);
    if (/does not exist|could not find/i.test(eErr.message)) {
      console.error('→ supabase/rudy-evidence.sql을 SQL Editor에서 실행해야 한다.');
    }
    process.exit(1);
  }

  // 후보 풀 — pickQuestion과 같은 조건 (설명 없음 + 프로젝트 미소속 + 30일 + 안 물어본 것)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: rows } = await supabase.from('fragments')
    .select('id, type, content, link_title, created_at')
    .eq('archived', false).is('note', null).gte('created_at', since)
    .order('created_at', { ascending: false });
  const { data: inProjects } = await supabase.from('fragment_projects').select('fragment_id');
  const grouped = new Set((inProjects ?? []).map((r) => r.fragment_id));
  const askedIds = new Set(questions.flatMap((q) => q.item_ids ?? []));
  const pool = (rows ?? []).filter((f) => !askedIds.has(f.id) && !grouped.has(f.id));

  console.log(`\n후보 ${pool.length}개 (설명 없음 · 프로젝트 미소속 · 30일 이내 · 안 물어본 것)`);
  for (const f of pool.slice(0, 5)) console.log(`   ${f.created_at.slice(0, 10)}  ${label(f)}`);
  if (pool.length > 5) console.log(`   … 외 ${pool.length - 5}개`);

  console.log(`\n물어본 이력 ${questions.length}건`);
  for (const q of questions) {
    const state = q.user_response === 'acted' ? '✅ 답 받음' : '· 대기';
    console.log(`   ${q.created_at.slice(0, 10)}  ${state}`);
  }

  console.log(`\n받아낸 자기 진술 ${evidence.length}건 ← §2-1의 경계선을 넘어 저장되는 유일한 것`);
  for (const e of evidence) {
    console.log(`   ${e.created_at.slice(0, 10)}  "${e.stated_text.replace(/\s+/g, ' ').slice(0, 60)}"`);
    console.log(`      ↳ 설명하는 파편 ${e.related_item_ids.length}개`);
  }
  if (!evidence.length) {
    console.log('   (아직 없음 — 루디가 묻고 네가 답해야 쌓인다)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
