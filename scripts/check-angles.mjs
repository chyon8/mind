// 발견 브리핑의 '각도 결정'을 앱 없이 뽑아본다 — 검색하기 전에 판단력부터 검증한다.
//   node scripts/check-angles.mjs                 ← 기본 모델(gpt-5.5)로
//   node scripts/check-angles.mjs gpt-4o          ← 모델 바꿔서 (§8-1 실측: gpt-4o는 각도가 얕다)
//
// 왜 검색 전에 이걸 먼저 보나 (RUDY-DISCOVERY §7·§8): 발견 퀄리티는 검색 API가 아니라 판단에서
// 나온다. 각도가 좋은지 여기서 보면 검색에 한 푼 쓰기 전에 "이 모델이 잘 판단하나"를 판가름한다.

import {
  ANGLE_SYS, callOpenAI, dedupeAngles, loadEnv, loadMaterial, makeClient, parseAngles,
  recentBriefContext,
} from './_discovery-lib.mjs';

const MODEL = process.argv[2] ?? 'gpt-5.5';
const env = loadEnv();
if (!env.url || !env.role) { console.error('SUPABASE_URL / SERVICE_ROLE_KEY 필요'); process.exit(1); }
if (!env.openai) { console.error('OPENAI_API_KEY(또는 OPEN_AI_API_KEY) 필요'); process.exit(1); }

const supabase = makeClient(env.url, env.role);

async function main() {
  const { block: rawBlock, pickedCount } = await loadMaterial(supabase);
  // brief.ts와 같이 <이미 다룬 주제>를 붙인다 — 안 붙이면 진단이 실물과 다른 입력으로 돈다.
  const prior = await recentBriefContext(supabase);
  const block = rawBlock + (prior.topics.length ? `\n\n<이미 다룬 주제 (다시 꺼내지 마라)>\n${prior.topics.join(' / ')}` : '');
  console.log(`모델: ${MODEL} / 재료 ${block.split('\n').length}줄 / 이미 다룬 주제 ${prior.topics.length}개\n`);

  const out = await callOpenAI(env.openai, MODEL, ANGLE_SYS, block);
  let parsed;
  try { parsed = parseAngles(out, pickedCount); }
  catch { console.error('JSON 파싱 실패. 원문:\n', out); process.exit(1); }
  console.log(`뽑힌 각도 ${parsed.length}개`);

  // 중복 게이트 — brief.ts와 같은 자리·같은 임계. 여기서 뭐가 왜 잘렸는지 눈으로 본다.
  const gate = await dedupeAngles(env.openai, parsed, prior.topics);
  const angles = gate.kept;
  if (gate.dropped.length) {
    console.log(`중복 게이트: ${gate.dropped.length}개 제거${gate.abandoned ? ' → 너무 많이 잘려 컷 포기(안전망)' : ''}`);
    for (const d of gate.dropped) {
      console.log(`  ✕ ${d.query.slice(0, 45)} (${d.sim.toFixed(3)}) ← ${d.against.slice(0, 55)}`);
    }
  } else {
    console.log('중복 게이트: 제거 없음');
  }

  const label = { expansion: '확장', new: '새로움', resurface: '되꺼냄' };
  const counts = { expansion: 0, new: 0, resurface: 0 };
  console.log(`\n남은 각도 ${angles.length}개\n`);
  for (const a of angles) {
    counts[a.slot] = (counts[a.slot] ?? 0) + 1;
    console.log(`[${label[a.slot] ?? a.slot}] ${a.query || '(검색 없음 — 되꺼냄)'}`);
    if (a.from) console.log(`   ← ${a.from}`);
    console.log(`   · ${a.why}\n`);
  }
  console.log(`구성: 확장 ${counts.expansion} · 새로움 ${counts.new} · 되꺼냄 ${counts.resurface}`);
  console.log('\n판단: 각도가 좋은가? 프로덕트로만 쏠리지 않았나? 음악이 섞이지 않았나?');
  console.log('좋으면 → node scripts/check-brief.mjs (실제 검색+조립). 나쁘면 → 프롬프트/모델을 고친다.');
}

main().catch((e) => { console.error(e); process.exit(1); });
