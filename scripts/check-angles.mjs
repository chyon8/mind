// 발견 브리핑의 '각도 결정'을 앱 없이 뽑아본다 — 검색하기 전에 판단력부터 검증한다.
//   node scripts/check-angles.mjs                 ← 기본 모델(gpt-5.5)로
//   node scripts/check-angles.mjs gpt-4o          ← 모델 바꿔서 (§8-1 실측: gpt-4o는 각도가 얕다)
//
// 왜 검색 전에 이걸 먼저 보나 (RUDY-DISCOVERY §7·§8): 발견 퀄리티는 검색 API가 아니라 판단에서
// 나온다. 각도가 좋은지 여기서 보면 검색에 한 푼 쓰기 전에 "이 모델이 잘 판단하나"를 판가름한다.

import { ANGLE_SYS, callOpenAI, loadEnv, loadMaterial, makeClient, parseAngles } from './_discovery-lib.mjs';

const MODEL = process.argv[2] ?? 'gpt-5.5';
const env = loadEnv();
if (!env.url || !env.role) { console.error('SUPABASE_URL / SERVICE_ROLE_KEY 필요'); process.exit(1); }
if (!env.openai) { console.error('OPENAI_API_KEY(또는 OPEN_AI_API_KEY) 필요'); process.exit(1); }

const supabase = makeClient(env.url, env.role);

async function main() {
  const { block } = await loadMaterial(supabase);
  console.log(`모델: ${MODEL} / 재료 ${block.split('\n').length}줄\n`);

  const raw = await callOpenAI(env.openai, MODEL, ANGLE_SYS, block);
  let angles;
  try { angles = parseAngles(raw); }
  catch { console.error('JSON 파싱 실패. 원문:\n', raw); process.exit(1); }

  const label = { expansion: '확장', new: '새로움', resurface: '되꺼냄' };
  const counts = { expansion: 0, new: 0, resurface: 0 };
  console.log(`각도 ${angles.length}개\n`);
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
