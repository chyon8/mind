// 클러스터 엔진을 앱 없이 검증하고 **임계값을 실측으로 정한다** (RUDY.md §6-2).
//   node scripts/check-clusters.mjs              ← 여러 임계값을 훑어 축이 몇 개 서는지 본다
//   node scripts/check-clusters.mjs 0.44         ← 그 임계값으로 축 내용을 전부 펼쳐 본다
//   node scripts/check-clusters.mjs 0.44 --days 180
//
// RPC가 없으면 "function ... does not exist" → supabase/rudy-cluster.sql 실행 필요.
//
// 왜 이걸 먼저 만드는가: 충돌 임계값을 0.35로 정했다가 실측 후 0.42로 올린 전례가 있다.
// 임베딩 이방성 때문에 "적당해 보이는 숫자"는 코퍼스마다 틀린다. 코드 짜기 전에 눈으로 본다.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const dayFlag = args.indexOf('--days'); // -1일 때 args[0]을 집지 않게 (임계값을 날짜로 읽었다)
const DAYS = dayFlag >= 0 ? Number(args[dayFlag + 1]) || 90 : 90;
const PICK = Number(args.find((a) => !a.startsWith('--') && Number(a)));
const SWEEP = [0.34, 0.38, 0.42, 0.46, 0.5, 0.54];
const MIN_SIZE = 3; // §4-B1: 근거 파편 ≥3개. 2개짜리는 축이 아니라 그냥 닮은 둘이다.

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

// ⚠️ supabase/functions/_shared/cluster.ts와 **같은 로직**이어야 한다 (embedText 선례와 동일한 약속).
// 여기서 튜닝한 숫자가 저기서 다른 결과를 내면 튜닝 자체가 무의미해진다.
//
// 평균연결(average linkage). 단일연결(=연결요소)을 안 쓰는 이유: A–B, B–C만 있어도 A·C가
// 한 덩어리가 된다(체이닝). "기타"와 "카페 창업"이 중간 파편 하나로 이어지면 축이 아니라 죽이다.
// 평균연결은 두 덩어리 사이 **모든 쌍**의 평균을 보므로 다리 하나로는 안 붙는다.
function cluster(edges, minAvg) {
  // 노드 = 엣지에 등장한 것만. 아무와도 안 닿은 파편은 애초에 축이 될 수 없다.
  const nodes = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const groups = new Map(nodes.map((n, i) => [i, [n]]));

  const key = (i, j) => (i < j ? `${i}|${j}` : `${j}|${i}`);
  const sum = new Map(); // 덩어리 쌍 사이 유사도 합 (임계 미만 쌍은 0으로 친다)
  for (const e of edges) {
    const k = key(idx.get(e.a), idx.get(e.b));
    sum.set(k, (sum.get(k) ?? 0) + e.similarity);
  }

  for (;;) {
    let bestK = null;
    let bestAvg = minAvg; // 임계 미만이면 더 안 붙인다
    for (const [k, s] of sum) {
      const [i, j] = k.split('|').map(Number);
      const avg = s / (groups.get(i).length * groups.get(j).length);
      if (avg >= bestAvg) { bestAvg = avg; bestK = k; }
    }
    if (!bestK) break;

    const [i, j] = bestK.split('|').map(Number);
    groups.set(i, [...groups.get(i), ...groups.get(j)]);
    groups.delete(j);
    for (const [k, s] of [...sum]) {
      const [x, y] = k.split('|').map(Number);
      if (x !== j && y !== j) continue;
      sum.delete(k);
      const other = x === j ? y : x;
      if (other === i) continue;
      const nk = key(i, other);
      sum.set(nk, (sum.get(nk) ?? 0) + s); // 흡수한 쪽의 합을 물려받는다
    }
  }
  return [...groups.values()].filter((g) => g.length >= MIN_SIZE);
}

// vividness.ts와 같은 감쇠 법칙 (진단용 재현 — 앱의 원천은 vividness.ts다)
function vividness(fr, now = new Date()) {
  if (fr.tier === 'pinned') return 1;
  const tier = fr.tier === 'normal' && fr.touch_count >= 2 ? 'important' : fr.tier;
  const [start, floor] = tier === 'important' ? [14, 45] : [3, 14];
  const days = Math.max(0, (now - new Date(fr.last_touched_at)) / 86_400_000);
  if (days <= start) return 1;
  if (days >= floor) return 0.25;
  return 1 - 0.75 * ((days - start) / (floor - start));
}

// §4-B2 지속성 척도 = 증거 타임스탬프 분포. LLM한테 안 맡긴다 — 이건 계산이다.
// _shared/cluster.ts의 shape()와 같은 판정을 유지할 것.
// 저장일 3일 이상을 함께 요구하는 이유: 하루에 몰아 저장 + 한 달 뒤 1개면 span은 길지만
// 그건 반복된 관심이 아니라 두 번 있었던 일이다.
function shape(dates) {
  const t = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const spanDays = (t.at(-1) - t[0]) / 86_400_000;
  const quietDays = (Date.now() - t.at(-1)) / 86_400_000;
  // 날짜 경계는 KST (_shared/time.ts kstDate와 같은 계산) — UTC로 세면 새벽 저장분이 별개 날로 잡힌다
  const kstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const activeDays = new Set(dates.map(kstDate)).size;
  const kind = spanDays >= 21 && activeDays >= 3 ? '지속' : spanDays <= 7 ? '단발' : '중간';
  return { spanDays, quietDays, activeDays, kind };
}

const label = (f) => ((f?.type === 'link' ? f.link_title ?? f.content : f?.content) ?? '?')
  .replace(/\s+/g, ' ').slice(0, 52);

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data: frags, error: fErr } = await supabase
    .from('fragments')
    .select('id, type, content, link_title, created_at, last_touched_at, tier, touch_count')
    .eq('archived', false)
    .gte('created_at', since);
  if (fErr) { console.error(fErr.message); process.exit(1); }

  const { count: embedded } = await supabase
    .schema('rudy').from('fragment_embeddings')
    .select('*', { count: 'exact', head: true });

  console.log(`최근 ${DAYS}일 살아있는 파편 ${frags.length}개 / 전체 임베딩 ${embedded}개`);
  if (frags.length < 10) {
    console.log('⚠️  코퍼스가 너무 작다 — 축이 안 서는 게 정상이다. --days를 늘려서 볼 것.');
  }

  const { data: edges, error } = await supabase.schema('rudy').rpc('cluster_edges', {
    days: DAYS,
    min_sim: Math.min(...SWEEP),
  });
  if (error) {
    console.error('\nRPC 에러:', error.message);
    if (/does not exist|could not find/i.test(error.message)) {
      console.error('→ supabase/rudy-cluster.sql을 SQL Editor에서 실행해야 한다.');
    }
    process.exit(1);
  }
  console.log(`엣지 ${edges.length}개 (sim ≥ ${Math.min(...SWEEP)})`);
  if (!edges.length) {
    console.log('\n닿는 쌍이 하나도 없다. 임계를 더 내려보거나(SWEEP 수정) 임베딩 백필을 확인할 것.');
    return;
  }

  const byId = new Map(frags.map((f) => [f.id, f]));
  const now = new Date();

  // ── 임계 스윕: "몇 개의 축이 서는가"를 임계별로 본다.
  //    너무 낮으면 거대한 한 덩어리(전부 하나), 너무 높으면 0개. 그 사이가 쓸 만한 구간이다.
  if (!PICK) {
    console.log('\n임계값 스윕 — 쓸 만한 구간을 눈으로 찾는다\n');
    console.log('  임계   축   묶인파편   최대축   축 미리보기');
    for (const th of SWEEP) {
      const cs = cluster(edges.filter((e) => e.similarity >= th), th)
        .sort((a, b) => b.length - a.length);
      const covered = cs.reduce((n, c) => n + c.length, 0);
      const preview = cs.slice(0, 2).map((c) => `${c.length}개:${label(byId.get(c[0]))}`).join(' / ');
      console.log(
        `  ${th.toFixed(2)}  ${String(cs.length).padStart(3)}   ${String(covered).padStart(6)}` +
        `   ${String(cs[0]?.length ?? 0).padStart(5)}   ${preview.slice(0, 70)}`,
      );
    }
    console.log('\n판단 기준:');
    console.log('  · 최대축이 코퍼스의 절반이면 → 임계가 낮다 (다 뭉쳐서 아무 말도 아님)');
    console.log('  · 축 0~1개면 → 임계가 높다');
    console.log('  · 축 3~8개, 최대축이 전체의 1/4 이하 ← 이 근처를 골라 아래로 확인:');
    console.log('\n    node scripts/check-clusters.mjs 0.44');
    return;
  }

  // ── 고른 임계값으로 축 내용을 전부 펼친다. 여기서 "이게 정말 한 축인가"를 사람이 판단한다.
  const clusters = cluster(edges.filter((e) => e.similarity >= PICK), PICK)
    .map((ids) => {
      const items = ids.map((id) => byId.get(id)).filter(Boolean);
      const s = shape(items.map((f) => f.created_at));
      // 선명도 가중 (§6-2: 흐려진 증거는 약하게 반영). 순위에만 쓴다.
      const weight = items.reduce((n, f) => n + vividness(f, now), 0);
      return { items, ...s, weight };
    })
    .sort((a, b) => b.weight - a.weight);

  console.log(`\n임계 ${PICK} → 축 ${clusters.length}개 (크기 ≥ ${MIN_SIZE})\n`);
  for (const c of clusters) {
    console.log(
      `━ ${c.kind} · 파편 ${c.items.length}개 · ${Math.round(c.spanDays)}일에 걸침 · ` +
      `저장일 ${c.activeDays}일 · 마지막 증거 ${Math.round(c.quietDays)}일 전 · ` +
      `가중치 ${c.weight.toFixed(1)}`,
    );
    for (const f of c.items.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      console.log(`   ${f.created_at.slice(0, 10)}  ${label(f)}`);
    }
    console.log();
  }

  const covered = clusters.reduce((n, c) => n + c.items.length, 0);
  console.log(`묶인 파편 ${covered} / ${frags.length}개 (나머지는 어느 축에도 안 닿음 — 정상이다)`);
  console.log('\n각 축을 보고 물어볼 것: 이 목록이 **하나의 이름**을 가질 수 있나?');
  console.log('억지로 이름 붙여야 하는 축이 있으면 임계를 올려라 (§2-8 억지 연결 금지).');
}

main().catch((e) => { console.error(e); process.exit(1); });
