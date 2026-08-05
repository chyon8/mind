#!/usr/bin/env node
// 발견 — **코드가 오케스트레이션하는 병렬 파이프라인.** 각도(3호출) → 검색(N호출 동시) → 조립(1호출).
//
//   node scripts/discover-parallel/run.mjs             ← 만들고 .work/에만 남긴다 (기본: 저장 안 함)
//   node scripts/discover-parallel/run.mjs --angles    ← 각도만 뽑고 종료 (검색·조립 안 씀)
//   node scripts/discover-parallel/run.mjs --material  ← 재료만 뽑고 종료 (LLM 안 태움, 공짜)
//   node scripts/discover-parallel/run.mjs --save      ← 원장(rudy.utterances)에도 넣는다
//
// ── 왜 또 만드나 (2026-08-04 실측)
//
// 채택판(`discover-websearch/`)이 6~11분 걸린다. 세션 로그를 6회분 까서 쟀더니:
//   · **시간 = Opus 출력토큰 ÷ 56tok/s.** 상관계수 0.993 (턴 수는 0.668로 훨씬 약하다).
//   · 그 출력토큰의 **95%가 thinking**이다. 최종 브리핑은 5%.
//   · 웹검색 13회 = 약 3초. 재료 로딩 = 1초. **둘 다 시간에 안 잡힌다.**
//   · 한 세션이 각도 12개를 **순차로** 처리한다: 검색 → 189초 생각 → 검색 → 102초 생각.
//
// 그리고 `discover-claude/run.mjs:13`에 이관 이유가 "원리 D(재시도 루프)가 공짜로 들어온다"로
// 적혀 있다 — **에이전트 아키텍처는 루프를 얻으려고 채택됐다.** 그 뒤 유저가 루프를 껐는데
// (`discover-websearch/prompt.md:59`) 아키텍처는 안 되돌리고 프롬프트에 "재시도하지 마라"만
// 넣었다. **루프의 이득은 없고 에이전트의 비용만 남은 상태다.**
//
// 그래서 이 판은 오케스트레이션을 코드로 되돌린다:
//   · 각도를 **확장 ‖ 아이디어 두 갈래로 동시에** 뽑는다 (`check-brief.mjs`의 Promise.all 복원).
//   · 검색을 **각도 하나당 프로세스 하나로 전부 동시에** 던진다. 이게 벽시계의 핵심이다 —
//     한 세션이 순차로 돌던 걸 코드가 나누면 그대로 병렬이 된다.
//   · 각 검색 프로세스는 **자기 검색어 하나만** 본다. 그래서 컨텍스트가 안 자란다
//     (RUDY-STATUS "검색 결과가 턴마다 쌓여 캐시읽기가 528K까지 자랐다"가 구조적으로 없어진다).
//   · 각도·조립 단계는 `--allowedTools ''` — **툴이 0개다.** 루프가 생길 수 없다.
//
// ── 속도 말고 하나 더 고친다: `idea` 슬롯이 구조로 강제된다
//
// 채택판은 파편을 계속 보면서 "동기만 보고 검색어를 만들어라"를 **부탁**한다
// (`discover-websearch/prompt.md:77-85`가 "여기가 제일 어려운 자리다"라고 자백한다).
// 여기선 호출을 둘로 쪼갠다: 1단계가 동기만 뽑고, **2단계 프롬프트에 파편이 물리적으로
// 안 들어간다.** RUDY-DISCOVERY §7-f "프롬프트 규칙이 아니라 구조다"를 그대로 지킨다.
//
// ── 안 건드리는 것
//
// **`discover-websearch/`(채택판)를 손대지 않는다** (유저 지시 2026-08-04: "지금 꺼는 그대로 둬").
// 그게 대조군이다. `discover-claude/`·`discover-split/`·Edge 함수·앱도 전부 그대로다.
// 재료 로더(`discover-claude/material.mjs`)는 **가져다 쓴다 — 복제하지 않는다.**
// 비교의 공정성이 거기 달려 있다(재료가 같아야 한다).
//
// 과금: 전부 `claude -p`라 **구독에 묻는다.** Exa도 OpenAI도 안 쓴다 (유저 지시 2026-08-04:
// "exa는 쓰지마, 그냥 클로드 안에서만"). 임베딩 중복게이트도 따라서 없다 — 재료 안의
// <이미 다룬 주제>가 그 역할을 한다 (RUDY-STATUS "막는 게 잡는 것보다 6배 싸다").

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildMaterial, client } from '../discover-claude/material.mjs';

const HERE = new URL('.', import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const WORK = new URL('.work/', HERE);
const MODEL = process.env.DISCOVER_P_MODEL ?? 'claude-opus-5';

// thinking 예산 — **기본은 안 건드린다(설정 상속, 지금은 high).**
//
// ⚠️ 한때 단계별로 낮춰뒀다가 되돌렸다 (2026-08-04, 유저 지적 "effort 뭐하러 고쳐?
//    그대로 high로 둬도 빨라지는 거 아니야?"). 재보니 맞는 말이었다:
//
//      채택판(discover-websearch)   394~671초 · 항목 8개
//      이 판, 전부 high             348초 · 항목 8개
//      이 판, 단계별로 낮춤          210초 · **항목 5개**
//
//    **속도를 만든 건 effort가 아니라 병렬화다.** 낮춰서 번 138초의 대가가 항목 3개였고,
//    특히 `search`를 low로 두면 검색이 죽는다 — 결과를 받은 각도가 7/8 → 4/7로 떨어졌다.
//    얕게 던지고 "쓸 게 없다"고 일찍 포기한다. 항목 수가 깎인 진짜 원인이 이거였다.
//
//    각도 단계만 보면 low가 22초/1,174토큰 vs high 164초/9,535토큰으로 극적이지만,
//    그건 벽시계의 일부일 뿐이고 전체로는 위 표가 답이다. **다시 낮추지 마라.**
//
// 실험용 손잡이는 남긴다: `DISCOVER_P_EFFORT=low npm run discover:p`
const EFFORT = process.env.DISCOVER_P_EFFORT ?? null;

// 중복 게이트가 자르고 남길 최소 각도 수. 과하게 자르면 브리핑이 비는데 그건 중복보다 나쁘다.
const GATE_FLOOR = 8;
// RUDY-STATUS 「절대 건드리지 말 것」의 확정값. 게이트도 이 아래로는 못 자른다.
const IDEA_MIN = 2;

// 각도 상한 — 프롬프트를 믿지 않고 코드로 자른다(모델이 넘겨도 여기서 잘린다).
// lens 2는 유저 확정값이다 (RUDY-STATUS 「절대 건드리지 말 것」: LENS_MAX=2 · IDEA_MIN=2는 한 세트).
// ⚠️ **채우라는 뜻이 아니다.** 2026-07-30 실측에서 개수를 강제했더니 남는 칸이 사업·투자
//    파편으로 채워져 브리핑이 수수료·매출 얘기로 쏠렸다. 이건 천장이지 정원이 아니다.
// expansion 7 — 중복 게이트가 실측상 40%를 자르므로(2026-08-04: 12개 중 5개) **죽을 몫을
//    미리 얹는다.** 게이트 없이 이 숫자를 쓰면 위 07-30 사고가 그대로 재발한다.
const CAP = { expansion: 7, idea: 4, lens: 2, resurface: 1 };
const SLOTS = Object.keys(CAP);

const anglesOnly = process.argv.includes('--angles');
const materialOnly = process.argv.includes('--material');
const save = process.argv.includes('--save');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (...a) => console.log('[discover-p]', ...a);

mkdirSync(WORK, { recursive: true });
const t0 = Date.now();
const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}초`;

// ── 1. 재료 ──────────────────────────────────────────────────────────────────
const sb = client();
const { md, stats } = await buildMaterial(sb);
writeFileSync(new URL(`material-${stamp}.md`, WORK), md);
log('재료:', JSON.stringify(stats), `(${md.length}자)`);
// 지정 상태를 맨 앞에서 못박는다 — 0인지 쿼리가 조용히 실패한 건지 구분이 안 되던 자리다.
log(stats.picked ? `⭐ 유저 지정 ${stats.picked}개 — 반드시 항목으로 나와야 한다` : '유저 지정 없음 (앱에서 "다음 발견에 포함"을 누르면 여기 뜬다)');
if (materialOnly) process.exit(0);

// RUDY-DISCOVERY.md를 **코드가 읽어 프롬프트에 인라인한다.** 모델에게 Read 툴을 주지 않는
// 이유가 이것이다 — 파일을 읽는 왕복이 호출마다 턴을 하나씩 더 만들고, 잘려 읽힐 수도 있다.
const discovery = readFileSync(new URL('RUDY-DISCOVERY.md', ROOT), 'utf8');

// 조립 단계에 넘길 중복 방지 블록. 재료의 마지막 두 구획(<이미 다룬 주제> + <이미 저장한 링크>)을
// 그대로 잘라 쓴다 — 조립은 재료 전체를 안 받으므로 이 가드만 따로 넘긴다.
const guardsAt = md.indexOf('=== 이미 다룬 주제');
const guards = guardsAt >= 0 ? md.slice(guardsAt) : '';
if (!guards) log('⚠️ 재료에서 중복 방지 구획을 못 찾았다 — 조립이 가드 없이 돈다');

// 중복 게이트가 볼 목록 — **브리핑 제목만**이다. 뒤의 <이미 저장한 링크> 구획은 성격이 달라서
// (저장물이지 다룬 주제가 아니다) 끊어낸다. 섞으면 게이트가 "저장한 링크와 겹친다"고 자른다.
const linksAt = md.indexOf('=== 이미 저장한 링크');
const prior = guardsAt >= 0
  ? md.slice(guardsAt, linksAt > guardsAt ? linksAt : undefined)
      .split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4))
  : [];

// ── claude -p 한 번 = 1단계 ──────────────────────────────────────────────────
const runs = [];
async function runClaude(promptText, label, { tools = '', effort = null } = {}) {
  const started = Date.now();
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--model', MODEL,
        '--output-format', 'json',
        // ⚠️ **툴을 안 주는 게 루프를 없애는 실제 장치다** (프롬프트로 "돌지 마라"고 적는 게 아니라).
        //    검색 단계만 WebSearch를 받고, 그것도 자기 검색어 하나만 본다.
        '--allowedTools', tools,
        ...(effort ? ['--effort', effort] : []),
      ],
      { cwd: ROOT.pathname, stdio: ['pipe', 'pipe', 'inherit'] },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`claude 종료 코드 ${code} (${label})`)),
    );
    child.stdin.end(promptText);
  });

  writeFileSync(new URL(`raw-${label}-${stamp}.json`, WORK), raw);
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`claude 출력이 JSON이 아니다 — .work/raw-${label}-${stamp}.json 확인`);
  }
  const secs = Math.round((Date.now() - started) / 1000);
  const out = json.usage?.output_tokens ?? 0;
  // 출력토큰을 찍는다 — **이게 시간의 원인이라는 게 실측 결론**이라 턴 수보다 이 숫자가 중요하다.
  runs.push({ label, secs, turns: json.num_turns ?? 0, out, cost: json.total_cost_usd ?? 0 });
  log(`  ${label}: ${secs}초 · ${json.num_turns}턴 · 출력 ${out}토큰`);
  return json.result ?? '';
}

// 서론이 붙어도 견딘다 — 프롬프트로 모델의 습관을 막으려 하지 말고 **파서가 견딘다**
// (RUDY-STATUS 교훈). 첫 `{`부터 마지막 `}`까지만 본다.
function parseJson(raw, label) {
  const body = raw.replace(/^\s*```(?:json)?/, '').replace(/```\s*$/, '').trim();
  const s = body.indexOf('{');
  const e = body.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error(`${label} 출력에서 JSON을 못 찾았다`);
  try {
    return JSON.parse(body.slice(s, e + 1));
  } catch (err) {
    throw new Error(`${label} JSON 파싱 실패: ${err.message}`);
  }
}

const str = (v) => (v ?? '').toString().trim();

// ── 2. 각도 — 확장 ‖ (동기 → 아이디어) ───────────────────────────────────────
// 두 갈래가 서로를 안 기다린다. 아이디어 갈래만 안에서 2단계로 순차다.
log(`각도 뽑는 중 — 확장 ‖ 아이디어(2단계)${EFFORT ? `, effort=${EFFORT} (실험)` : ''}`);

const expansionPrompt = readFileSync(new URL('prompt-expansion.md', HERE), 'utf8')
  .replace('{{DISCOVERY}}', discovery)
  .replace('{{MATERIAL}}', md);

const motivePrompt = readFileSync(new URL('prompt-motive.md', HERE), 'utf8')
  .replace('{{DISCOVERY}}', discovery)
  .replace('{{MATERIAL}}', md);

const [expansionAngles, ideaAngles] = await Promise.all([
  // 확장 갈래 — expansion / lens / resurface
  runClaude(expansionPrompt, 'expansion', { effort: EFFORT }).then((raw) =>
    (parseJson(raw, 'expansion').angles ?? [])
      .filter((a) => a && ['expansion', 'lens', 'resurface'].includes(a.slot))
      .map((a) => ({
        slot: a.slot,
        query: str(a.query),
        from: str(a.from),
        why: str(a.why),
        motive: null,
        from_picked: a.from_picked === true,
      }))
      // resurface만 query가 없어도 된다. 나머지는 검색어가 없으면 쓸 수 없다.
      .filter((a) => a.slot === 'resurface' || a.query),
  ),

  // 아이디어 갈래 — 여기가 이 판의 구조적 이득이다.
  (async () => {
    const s1 = parseJson(await runClaude(motivePrompt, 'motive', { effort: EFFORT }), 'motive');
    const motives = (s1.items ?? [])
      .map((it) => ({ frag: str(it?.frag), motive: str(it?.motive), from_picked: it?.from_picked === true }))
      .filter((it) => it.motive)
      .slice(0, CAP.idea);
    if (!motives.length) {
      log('  ⚠️ 1단계가 동기를 못 냈다 — 아이디어 각도 0개');
      return [];
    }
    // ★ 여기가 전부 — **동기만 넘긴다. 파편은 안 들어간다.** ★
    // 프롬프트에 `{{MATERIAL}}`이 없다. 소재가 안 보이니 따라갈 수가 없다.
    const ideaPrompt = readFileSync(new URL('prompt-idea.md', HERE), 'utf8')
      .replace('{{DISCOVERY}}', discovery)
      .replace('{{MOTIVES}}', motives.map((m, i) => `${i + 1}. ${m.motive}`).join('\n'));
    const s2 = parseJson(await runClaude(ideaPrompt, 'idea', { effort: EFFORT }), 'idea');
    return (s2.angles ?? [])
      .map((a, i) => ({
        slot: 'idea',
        query: str(a?.query),
        // 조립이 "어느 파편에서 나왔나"를 알아야 하므로 여기서 다시 이어붙인다.
        // 2단계 모델은 이걸 못 봤다 — 코드가 짝을 맞춘다.
        from: motives[i]?.frag ?? '',
        why: str(a?.area),
        motive: motives[i]?.motive ?? '',
        from_picked: motives[i]?.from_picked === true,
      }))
      .filter((a) => a.query);
  })(),
]);

// 아이디어를 앞에 둔다 — 상한에 걸려 잘릴 때 뒤가 잘리게 (IDEA_MIN=2를 지키는 자리).
const capped = capAngles([...ideaAngles, ...expansionAngles], stats.picked);
const angles = await dedupeGate(capped);
writeFileSync(new URL(`angles-${stamp}.json`, WORK), JSON.stringify(angles, null, 2));

function capAngles(list, pickedCount) {
  // 지정 파편 컷 — 지정 하나당 각도 하나까지 (angles.ts와 같은 규칙).
  let picked = 0;
  const afterPicked = pickedCount > 0
    ? list.filter((a) => !a.from_picked || ++picked <= pickedCount)
    : list;
  const seen = Object.fromEntries(SLOTS.map((s) => [s, 0]));
  return afterPicked.filter((a) => ++seen[a.slot] <= CAP[a.slot]);
}

// ── 2-b. 중복 게이트 ─────────────────────────────────────────────────────────
// **원래 파이프라인엔 이게 코드에 있었다** (`_discovery-lib.mjs`의 `dedupeAngles`, 임베딩 cosine).
// Exa를 빼면서 OpenAI 임베딩도 같이 빠졌고, 그 자리를 "재료 안의 <이미 다룬 주제>를 각도 모델이
// 알아서 피한다"는 **프롬프트 부탁**으로 뒀다. 그게 안 됐다 — 2026-08-04 실측에서 8항목 중
// 5개가 이미 다룬 파편에서 다시 출발했다(SmartKnob·파이썬 경로·페달·맥북·준이랑 유튜브).
//
// 각도 모델은 재료 26K를 읽느라 바빠서 239개 목록과 하나씩 대조하지 못한다. 그래서 **그 대조만
// 하는 호출을 따로 둔다.** 짧은 일이라 빠르고, 각도 단계를 low로 유지한 채 이 축만 되산다.
// 검색 전에 자르므로 죽은 각도의 검색 프로세스도 안 뜬다.
async function dedupeGate(list) {
  if (!prior.length || !list.length) return list;
  const numbered = list
    .map((a, i) => `${i + 1}. [${a.slot}]${a.from_picked ? ' picked:true' : ''} ${a.query || '(되꺼냄)'} ← ${a.from}`)
    .join('\n');

  let drop;
  try {
    const raw = await runClaude(
      readFileSync(new URL('prompt-gate.md', HERE), 'utf8')
        .replace('{{ANGLES}}', numbered)
        .replace('{{PRIOR}}', prior.map((t) => `- ${t}`).join('\n')),
      'gate',
      { effort: EFFORT },
    );
    drop = parseJson(raw, 'gate').drop ?? [];
  } catch (e) {
    // 게이트가 죽어도 파이프라인은 간다 — 중복이 섞이는 게 브리핑이 없는 것보단 낫다.
    log(`  ⚠️ 중복 게이트 실패 — 자르지 않고 간다: ${e.message.slice(0, 60)}`);
    return list;
  }

  // 지정 각도는 게이트가 뭐라 하든 못 버린다 (유저가 앱에서 직접 누른 것이다).
  const cuts = new Map(
    drop
      .filter((d) => Number.isInteger(d?.i) && list[d.i - 1] && !list[d.i - 1].from_picked)
      .map((d) => [d.i - 1, str(d.why)]),
  );

  // ⚠️ **`idea` 바닥이 먼저다.** 2026-08-04 실측에서 게이트가 idea 각도 4개를 전부 쳐내
  //    브리핑의 아이디어가 0개로 나갔다 — `IDEA_MIN = 2`(유저가 되돌리며 확정) 정면 위반이다.
  //    idea는 원래 재료가 얇아서 중복 판정이 잘 나온다. 중복인 채로라도 2개는 남긴다.
  const ideaLeft = () => list.filter((a, i) => a.slot === 'idea' && !cuts.has(i)).length;
  for (const i of [...cuts.keys()].sort((a, b) => a - b)) {
    if (ideaLeft() >= IDEA_MIN) break;
    if (list[i].slot === 'idea') cuts.delete(i);
  }

  // 전체 바닥 — 과하게 자르면 브리핑이 빈다. 넘치면 뒤쪽(=expansion 계열)부터 되살린다.
  const over = Math.max(0, GATE_FLOOR - (list.length - cuts.size));
  if (over) for (const i of [...cuts.keys()].sort((a, b) => b - a).slice(0, over)) cuts.delete(i);
  if (over) log(`  ⚠️ 게이트가 너무 많이 잘라서 ${over}개 되살렸다 (바닥 ${GATE_FLOOR}개)`);

  for (const [i, why] of cuts) log(`  ✕ [${list[i].slot}] ${(list[i].query || list[i].from).slice(0, 46)} — ${why.slice(0, 60)}`);
  log(cuts.size ? `중복 게이트: ${cuts.size}개 제거` : '중복 게이트: 제거 없음');
  return list.filter((_, i) => !cuts.has(i));
}

const bySlot = SLOTS.map((s) => `${s} ${angles.filter((a) => a.slot === s).length}`).join(' · ');
log(`각도 ${angles.length}개 (${elapsed()}) — ${bySlot}`);
for (const a of angles) {
  log(`  [${a.slot}] ${a.query || '(되꺼냄)'} ← ${a.from.slice(0, 60)}${a.motive ? ` (동기: ${a.motive})` : ''}`);
}
if (!angles.length) throw new Error('각도가 0개 — .work/raw-*를 확인');
if (anglesOnly) { log('--angles — 여기서 끝'); process.exit(0); }

// ── 3. 검색 — 각도 하나당 프로세스 하나, 전부 동시 ───────────────────────────
// **여기가 이 판의 핵심이다.** 채택판은 한 세션이 각도를 순차로 처리해서
// 검색 → 189초 생각 → 검색 → 102초 생각이 됐다. 코드가 나누면 그게 그대로 병렬이 된다.
// 각 프로세스는 자기 검색어 하나만 보므로 컨텍스트가 안 자란다.
const searchTpl = readFileSync(new URL('prompt-search.md', HERE), 'utf8');
const searchable = angles.filter((a) => a.slot !== 'resurface' && a.query);
log(`검색 ${searchable.length}개 동시 실행 (${elapsed()})`);

const digests = new Map();
await Promise.all(
  searchable.map(async (angle, i) => {
    const prompt = searchTpl
      .replace('{{QUERY}}', angle.query)
      .replace('{{WHY}}', angle.why || '(없음)');
    try {
      const out = await runClaude(prompt, `search-${i + 1}`, {
        tools: 'WebSearch',
        effort: EFFORT,
      });
      const text = out.trim();
      // 한 각도가 죽어도 나머지는 산다 — 결과 없는 각도는 조립이 버린다.
      digests.set(angle, text && text !== '(없음)' ? text : '');
    } catch (e) {
      log(`  ⚠️ 검색 실패 (${angle.query.slice(0, 40)}): ${e.message.slice(0, 60)}`);
      digests.set(angle, '');
    }
  }),
);
const hit = [...digests.values()].filter(Boolean).length;
log(`검색 완료 (${elapsed()}) — ${hit}/${searchable.length}개 각도가 결과를 받았다`);

// 조립이 읽을 payload. 각도의 from/why/motive를 같이 넘긴다 —
// 조립은 재료를 안 받으므로 "어느 파편에서 나왔나"의 유일한 출처가 이것이다.
const payload = angles
  .map((angle, i) => {
    const head = [
      `## 각도 ${i + 1} [${angle.slot}] ${angle.query || '(되꺼냄 — 검색 없음)'}`,
      `from: ${angle.from}`,
      `why: ${angle.why}`,
      ...(angle.motive ? [`motive: ${angle.motive}`] : []),
      ...(angle.from_picked ? ['**유저가 직접 지정한 파편이다 — 버리지 마라.**'] : []),
    ].join('\n');
    if (angle.slot === 'resurface') return `${head}\n(검색 없음 — 되꺼냄. 이 파편이 지금 왜 다르게 읽히는지만 써라.)`;
    const d = digests.get(angle);
    return `${head}\n${d || '(결과 없음 — 이 각도는 버려라.)'}`;
  })
  .join('\n\n');
writeFileSync(new URL(`payload-${stamp}.md`, WORK), payload);

// ── 4. 조립 ──────────────────────────────────────────────────────────────────
// effort를 안 넘긴다 — 글의 질이 바로 걸리는 자리라 상속값(설정의 high)을 그대로 쓴다.
log(`조립 중 (${elapsed()})`);
const assembleRaw = await runClaude(
  readFileSync(new URL('prompt-assemble.md', HERE), 'utf8')
    .replace('{{DISCOVERY}}', discovery)
    .replace('{{GUARDS}}', guards)
    .replace('{{PAYLOAD}}', payload),
  'assemble',
);

// ⚠️ 프롬프트로 모델의 마크업 습관을 막으려 하지 마라 — **파서가 견뎌야 한다** (RUDY-STATUS 교훈).
const cut = assembleRaw.indexOf('###');
const text = (cut >= 0 ? assembleRaw.slice(cut) : assembleRaw).trim();
writeFileSync(new URL(`briefing-${stamp}.md`, WORK), text || assembleRaw);

const items = (text.match(/^### /gm) ?? []).length;
const labels = ['확장', '아이디어', '관점', '되꺼냄']
  .map((l) => `${l} ${(text.match(new RegExp(`^### \\[${l}\\]`, 'gm')) ?? []).length}`)
  .join(' · ');
log(`브리핑 ${items}개 — ${labels}`);
log(`브리핑 파일: ${new URL(`briefing-${stamp}.md`, WORK).pathname}`);

// 벽시계와 출력토큰을 나란히 찍는다. **호출 시간의 합이 벽시계보다 크면 병렬이 실제로 먹은 것**이고,
// 그 차이가 이 판이 산 전부다. 채택판과 비교할 때 이 두 줄만 보면 된다.
const sumSecs = runs.reduce((a, r) => a + r.secs, 0);
const sumOut = runs.reduce((a, r) => a + r.out, 0);
log(
  `합계 — 벽시계 ${elapsed()} · 호출 ${runs.length}개(시간 합 ${sumSecs}초) · ` +
  `출력 ${sumOut}토큰 · ${runs.reduce((a, r) => a + r.turns, 0)}턴 · ` +
  `API환산 $${runs.reduce((a, r) => a + r.cost, 0).toFixed(3)} (구독이라 실청구 0)`,
);
log('  ↑ 채택판(discover-websearch) 실측은 394~671초 · 19,426~38,396토큰 · 15~18턴이었다');

// ── 5. 저장 (기본 안 함) ─────────────────────────────────────────────────────
// ⚠️ **기본이 저장 안 함인 이유** — 이건 비교용이다. 원장에 넣으면 ① 다음 실행의 재료에
//    <이미 다룬 주제>로 들어가 **비교 조건이 바뀌고** ② 앱 발견 탭에서 채택판 결과와
//    구분이 안 된다(둘 다 trigger='pull'). 읽어보고 쓸 만하면 `--save`로 넣는다.
if (!text || text === '(없음)') {
  log('볼 게 없다 (§2-8 침묵 기본값)');
  process.exit(0);
}
if (!save) {
  log('저장 안 함 — 원장에도 넣으려면 --save');
  console.log(`\n${text}\n`);
  process.exit(0);
}

// trigger='pull' — 이건 발견이지 아침 브리핑이 아니다 (discover-websearch/run.mjs의 주석 참고).
// cost_usd=0 — 구독에 묻어서 돈다. API 환산가를 적으면 원장이 거짓말을 한다.
const { error } = await sb.schema('rudy').from('utterances').insert({
  surface: 'briefing', kind: 'discovery', text, trigger: 'pull', cost_usd: 0,
});
if (error) throw new Error(`원장 저장 실패: ${error.message}`);
log('저장 완료 — 앱 발견 탭에서 보면 된다');

// 유저 지정을 소비한다 (한 번 나오고 끝 — 또 원하면 또 누른다).
// ⚠️ 유저 확정 2026-07-30: **자동으로 내린다.** 앱에서 일일이 찾아 끄는 건 불가능하다.
//    ✅ 다만 이 판은 각도가 JSON이라 `from_picked`로 **각도가 실제로 만들어졌는지 확인할 수
//    있다**(채택판은 출력이 마크다운이라 못 한다 — `brief.ts:377`이 인정한 한계).
//    각도조차 안 됐으면 유저는 아무것도 못 보고 표시만 잃는 것이므로 그때만 안 내린다.
// ⚠️ touch가 아니다: last_touched_at·touch_count를 안 건드리므로 §2-3은 지켜진다.
if (stats.picked) {
  const madeAngle = angles.filter((a) => a.from_picked).length;
  if (madeAngle) {
    const { error: pe } = await sb
      .from('fragments')
      .update({ discover_next: false, discover_next_slot: null })
      .eq('discover_next', true);
    if (pe) log(`⚠️ 지정 해제 실패: ${pe.message}`);
    else log(`지정 ${stats.picked}개 소비 (각도 ${madeAngle}개가 됐다 — 표시 내림)`);
  } else {
    log(`⚠️ 지정 ${stats.picked}개가 각도조차 안 됐다 — 표시를 안 내린다 (다음 판에 다시 시도)`);
  }
}
