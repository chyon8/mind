// 원장(rudy.utterances) + 게이트 로그(rudy.gate_log)를 읽는다.
//   node scripts/check-ledger.mjs         ← 최근 30일
//   node scripts/check-ledger.mjs 7       ← 최근 7일
//
// 이게 §6-6 월말 성적표의 원형이고, 임계값 튜닝의 근거다 —
// "감으로 0.42로 정했다"를 "로그 보니 0.38이 맞더라"로 바꾸는 게 이 스크립트의 목적.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DAYS = Number(process.argv[2] ?? 30);

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
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
const day = (iso) => iso.slice(5, 10);
const IGNORE_AFTER_H = 24; // 하루 지나도 무반응이면 ignored로 친다 (§6-6)

async function main() {
  const { data: utts, error } = await supabase
    .schema('rudy').from('utterances')
    .select('id, created_at, surface, kind, item_ids, text, user_response')
    .gte('created_at', since).order('created_at', { ascending: false });
  if (error) {
    console.error('원장 조회 실패:', error.message);
    if (/does not exist|could not find/i.test(error.message)) {
      console.error('→ supabase/rudy-ledger.sql을 SQL Editor에서 실행해야 한다.');
    }
    process.exit(1);
  }

  console.log(`═ 원장 — 최근 ${DAYS}일 루디가 한 말: ${utts.length}건\n`);
  if (utts.length) {
    const ids = [...new Set(utts.flatMap((u) => u.item_ids ?? []))];
    const { data: frags } = await supabase
      .from('fragments').select('id, type, content, link_title').in('id', ids);
    const byId = new Map((frags ?? []).map((f) => [f.id, f]));
    const now = Date.now();

    for (const u of utts) {
      const aged = (now - new Date(u.created_at)) / 3_600_000 > IGNORE_AFTER_H;
      const res = u.user_response ?? (aged ? 'ignored' : '대기중');
      const mark = { acted: '👍', dismissed: '👋', ignored: '· ', 대기중: '⏳' }[res] ?? '  ';
      const subject = (u.item_ids ?? [])
        .map((i) => byId.get(i))
        .map((f) => (f?.type === 'link' ? f.link_title ?? f.content : f?.content) ?? '?')
        .map((s) => s.replace(/\s+/g, ' ').slice(0, 40)).join(' + ');
      console.log(`${mark} ${day(u.created_at)} [${u.kind}] ${u.text ?? subject}`);
    }

    // §6-6 성적표 — 기능별 acted/dismissed/ignored
    const tally = {};
    for (const u of utts) {
      const aged = (now - new Date(u.created_at)) / 3_600_000 > IGNORE_AFTER_H;
      const res = u.user_response ?? (aged ? 'ignored' : null);
      if (!res) continue;
      tally[u.kind] ??= { acted: 0, dismissed: 0, ignored: 0 };
      tally[u.kind][res]++;
    }
    if (Object.keys(tally).length) {
      console.log('\n── 성적표 (§6-6)');
      for (const [kind, t] of Object.entries(tally)) {
        console.log(`   ${kind}: 👍${t.acted}  👋${t.dismissed}  ·${t.ignored}`);
      }
    }
  }

  const { data: gates } = await supabase
    .schema('rudy').from('gate_log')
    .select('created_at, gate, passed, reason, detail')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(40);

  console.log(`\n═ 게이트 판정 — 최근 ${gates?.length ?? 0}건\n`);
  for (const g of gates ?? []) {
    console.log(`${g.passed ? '✅' : '🔇'} ${day(g.created_at)} [${g.gate}] ${g.reason ?? ''}`);
    if (g.detail) console.log(`      ${JSON.stringify(g.detail)}`);
  }

  // 임계 튜닝의 핵심 질문: 침묵한 날들의 최고 유사도는 얼마였나?
  const misses = (gates ?? [])
    .filter((g) => g.gate === 'similarity' && !g.passed && g.detail?.best != null)
    .map((g) => g.detail.best);
  if (misses.length) {
    misses.sort((a, b) => b - a);
    console.log(
      `\n💡 침묵한 ${misses.length}번의 최고 유사도: ${misses.map((m) => m.toFixed(3)).join(', ')}`,
    );
    console.log('   이 숫자들이 "아까웠다" 싶으면 SIM_THRESHOLD를 낮춰라 (recall.ts).');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
