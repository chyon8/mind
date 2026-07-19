// 충돌 회상 RPC(rudy.collision_candidates)를 앱 없이 검증한다.
//   node scripts/check-collision.mjs           ← 실제 동작 그대로 (최근 3일 씨앗 + 감쇠 필터)
//   node scripts/check-collision.mjs 1         ← 씨앗 창을 1일로
//   node scripts/check-collision.mjs 1 --all   ← 감쇠 필터 끄고 유사도 분포만 본다 (튜닝용)
//
// RPC가 없으면 "function ... does not exist" → rudy-collision.sql 실행 필요.
//
// --all의 용도: 코퍼스가 어리면(모든 파편이 아직 선명하면) 후보가 전부 걸러져
// 유사도를 하나도 못 본다. 그 상태에서 SIM_THRESHOLD를 정할 수 없으므로 필터를 끄고 분포를 본다.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const SEED_DAYS = Number(args.find((a) => !a.startsWith('--')) ?? 3);
const SIM_THRESHOLD = 0.42; // recall.ts와 같은 값을 유지할 것
const NEAR_FLOOR = 0.7; // recall.ts와 동일

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

// vividness.ts와 같은 감쇠 법칙 (여기선 진단용 재현 — 앱의 원천은 vividness.ts다)
function vividness(fr, now = new Date()) {
  if (fr.tier === 'pinned') return 1;
  const tier = fr.tier === 'normal' && fr.touch_count >= 2 ? 'important' : fr.tier;
  const [start, floor] = tier === 'important' ? [14, 45] : [3, 14];
  const days = Math.max(0, (now - new Date(fr.last_touched_at)) / 86_400_000);
  if (days <= start) return 1;
  if (days >= floor) return 0.25;
  return 1 - 0.75 * ((days - start) / (floor - start));
}

const label = (f) => ((f?.type === 'link' ? f.link_title ?? f.content : f?.content) ?? '?')
  .replace(/\s+/g, ' ').slice(0, 42);

async function main() {
  const since = new Date(Date.now() - SEED_DAYS * 86_400_000).toISOString();
  const { data: seeds } = await supabase
    .from('fragments').select('id, type, content, link_title')
    .eq('archived', false).gte('created_at', since);
  const { count: alive } = await supabase
    .from('fragments').select('*', { count: 'exact', head: true }).eq('archived', false);

  // ── 케이스 1: 씨앗 없음
  if (!seeds?.length) {
    console.log(`최근 ${SEED_DAYS}일 던진 파편이 없다 → 씨앗 없음 = 충돌 없음 (랜덤 2개로 폴백).`);
    console.log('이건 설계대로다. 뭘 던지고 나서 다시 돌려봐라.');
    return;
  }
  console.log(`씨앗 ${seeds.length}개 (최근 ${SEED_DAYS}일) / 살아있는 파편 ${alive}개${ALL ? '  [--all: 감쇠 필터 끔]' : ''}`);
  if (seeds.length > alive * 0.5) {
    console.log(`⚠️  씨앗이 코퍼스의 절반을 넘는다 — 씨앗은 후보에서 제외되므로 비교할 대상이 거의 없다.`);
    console.log(`   더 좁은 창으로 다시 볼 것:  node scripts/check-collision.mjs 1 ${ALL ? '--all' : ''}`);
  }

  const { data: hits, error } = await supabase.schema('rudy').rpc('collision_candidates', {
    seed_ids: seeds.map((s) => s.id),
    min_age_days: ALL ? 0 : 7,
  });
  if (error) {
    console.error('\nRPC 에러:', error.message);
    if (/does not exist|could not find/i.test(error.message)) {
      console.error('→ supabase/rudy-collision.sql을 SQL Editor에서 (재)실행해야 한다.');
    }
    process.exit(1);
  }

  // ── 케이스 2: 후보 0개 — 침묵이 아니라 진단 대상이다
  if (!hits.length) {
    console.log(`\n후보 0개. 임계 미달이 아니라 비교 대상 자체가 없다는 뜻이다. 흔한 원인:`);
    console.log(`  · 코퍼스가 어리다 — 아직 아무것도 안 흐려졌다 (감쇠 사전 컷 7일)`);
    console.log(`  · 씨앗이 코퍼스 대부분이다 — 씨앗은 후보에서 빠진다`);
    console.log(`→ 벡터 계산 자체를 확인하려면:  node scripts/check-collision.mjs 1 --all`);
    return;
  }

  const { data: frags } = await supabase
    .from('fragments')
    .select('id, type, content, link_title, last_touched_at, tier, touch_count, let_go_at')
    .in('id', hits.map((h) => h.id));
  const byId = new Map((frags ?? []).map((f) => [f.id, f]));
  const seedById = new Map(seeds.map((s) => [s.id, s]));
  const now = new Date();

  console.log(`\n후보 ${hits.length}개 — 통과선 ${SIM_THRESHOLD}\n`);
  let passed = 0;
  for (const h of hits) {
    const f = byId.get(h.id);
    if (!f) continue;
    const viv = vividness(f, now);
    const fading = f.let_go_at == null && viv <= NEAR_FLOOR;
    const related = h.similarity >= SIM_THRESHOLD;
    if (related && (fading || ALL)) passed++;
    const mark = related ? (fading || ALL ? '✅' : '· 아직 선명') : '✗';
    console.log(
      `${mark} sim ${h.similarity.toFixed(3)} viv ${viv.toFixed(2)} | ${label(f)}` +
      `\n     ↳ 씨앗: ${label(seedById.get(h.seed_id))}`,
    );
  }

  // ── 임계값 튜닝의 근거: 분포를 보여준다
  const sims = hits.map((h) => h.similarity).sort((a, b) => b - a);
  const at = (p) => sims[Math.min(sims.length - 1, Math.floor(sims.length * p))].toFixed(3);
  console.log(`\n유사도 분포: 최고 ${sims[0].toFixed(3)} / 상위10% ${at(0.1)} / 중앙 ${at(0.5)} / 최저 ${sims.at(-1).toFixed(3)}`);
  console.log(`통과선 ${SIM_THRESHOLD} 이상: ${sims.filter((s) => s >= SIM_THRESHOLD).length}개`);
  console.log(
    ALL
      ? '\n[--all] 감쇠를 무시한 결과다. 실제로는 여기서 "흐려진 것"만 남는다.\n' +
        '위 목록에서 ✅ 중 정말 "부딪힌다"고 느껴지는 것들의 sim을 보고 통과선을 정해라.'
      : passed > 0
        ? `\n→ ${passed}개가 게이트 통과. 오늘 충돌 회상이 뜬다.`
        : '\n→ 통과 0개. 오늘은 랜덤 2개 (억지 충돌 없음 = 설계대로).',
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
