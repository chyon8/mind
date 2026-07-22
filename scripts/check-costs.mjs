// OpenAI 실제 청구액(Organization Costs API) vs 우리 추정치(rudy.llm_usage) 대조.
//   node scripts/check-costs.mjs        ← 최근 7일
//   node scripts/check-costs.mjs 30     ← 최근 N일
//
// 진단용. 우리 llm_usage.cost_usd는 우리가 유지하는 단가표(usage.ts)로 계산한 추정치라
// 틀릴 수 있다 — 이 스크립트는 OpenAI 쪽 원본 청구 기록과 대조해서 그 추정치가 맞는지 확인한다.
//
// OPENAI_ADMIN_KEY가 .env에 필요하다 — 일반 API 키(OPENAI_API_KEY)와 다르다.
// 발급: platform.openai.com/settings/organization/admin-keys (조직 소유자만 가능).
//
// ⚠️ 이 엔드포인트는 실측 검증 전이다(2026-07-22, 공식 문서 기준으로 작성) — 첫 실행에서
// 401/404가 나면 이 파일 맨 아래 "실패 시" 메모를 봐라.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없으면 순수 env로 */ }

const DAYS = Number(process.argv[2] ?? 7);
const ADMIN_KEY = process.env.OPENAI_ADMIN_KEY;
if (!ADMIN_KEY) {
  console.error('OPENAI_ADMIN_KEY가 .env에 없다.');
  console.error('발급: https://platform.openai.com/settings/organization/admin-keys (조직 소유자만)');
  console.error('.env에 OPENAI_ADMIN_KEY=sk-admin-... 한 줄 추가하고 다시 실행.');
  process.exit(1);
}

const startTime = Math.floor(Date.now() / 1000) - DAYS * 86_400;

async function fetchCosts() {
  const url = new URL('https://api.openai.com/v1/organization/costs');
  url.searchParams.set('start_time', String(startTime));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', String(DAYS + 1));
  url.searchParams.append('group_by', 'line_item');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${ADMIN_KEY}` } });
  if (!res.ok) throw new Error(`costs API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const costsResp = await fetchCosts();
  if (costsResp.has_more) {
    console.warn('⚠️  결과가 한 페이지를 넘는다(has_more=true) — 이 스크립트는 페이징을 안 한다. 기간을 줄여서 다시 돌리거나 페이징을 추가할 것.');
  }

  let openaiTotal = 0;
  const byLineItem = new Map();
  for (const bucket of costsResp.data ?? []) {
    for (const r of bucket.results ?? []) {
      const v = r.amount?.value ?? 0;
      openaiTotal += v;
      const key = r.line_item ?? '(line_item 없음)';
      byLineItem.set(key, (byLineItem.get(key) ?? 0) + v);
    }
  }

  const sb = createClient(
    process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const sinceIso = new Date(startTime * 1000).toISOString();
  const { data: rows, error } = await sb
    .schema('rudy')
    .from('llm_usage')
    .select('call_site, model, cost_usd')
    .gte('created_at', sinceIso);
  if (error) throw error;

  let ourTotal = 0;
  let unknownCount = 0;
  const byCallSite = new Map();
  for (const r of rows ?? []) {
    if (r.cost_usd == null) {
      unknownCount++;
      continue;
    }
    ourTotal += Number(r.cost_usd);
    byCallSite.set(r.call_site, (byCallSite.get(r.call_site) ?? 0) + Number(r.cost_usd));
  }

  console.log(`=== 최근 ${DAYS}일 ===\n`);
  console.log(`OpenAI 실제 청구액: $${openaiTotal.toFixed(4)}`);
  for (const [k, v] of [...byLineItem.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(32)} $${v.toFixed(4)}`);
  }

  console.log(`\n우리 추정치 (rudy.llm_usage): $${ourTotal.toFixed(4)}${unknownCount ? `  (+단가미상 ${unknownCount}건, 총액에 안 잡힘)` : ''}`);
  for (const [k, v] of [...byCallSite.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(32)} $${v.toFixed(4)}`);
  }

  // ⚠️ 이 스크립트는 임베딩 비용(embed/embedMany)을 추적하지 않는다(usage.ts 설계 — 티끌이라 뺌).
  // OpenAI 총액엔 임베딩이 섞여 있으니, 차이가 조금 나는 건 정상이다.
  const diff = openaiTotal - ourTotal;
  const pct = openaiTotal ? (diff / openaiTotal) * 100 : 0;
  console.log(`\n차이: $${diff.toFixed(4)} (${pct.toFixed(1)}%) — 임베딩은 우리 쪽에서 안 잡으므로 어느 정도 차이는 정상.`);
  if (Math.abs(pct) > 30) {
    console.log('⚠️  30% 넘게 차이난다 — 단가표(_shared/usage.ts)가 틀렸거나, 로깅 안 되는 호출부가 있는지 의심할 것.');
  } else {
    console.log('✅ 추정치가 실제 청구액과 대체로 맞다(임베딩 차이 감안).');
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  console.error('\n실패 시: OPENAI_ADMIN_KEY가 진짜 Admin 키인지(일반 sk-...가 아니라 sk-admin-...) 확인.');
  console.error('404면 Costs API가 이 조직에서 아직 안 열렸을 수 있다 — platform.openai.com 대시보드에서 직접 Usage 탭 확인.');
  process.exit(1);
});
