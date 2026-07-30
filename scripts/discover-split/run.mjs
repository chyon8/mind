#!/usr/bin/env node
// 발견 — **루프 없는** 3단계 파이프라인. 각도(클코) → 검색(Exa) → 조립(클코).
//
//   node scripts/discover-split/run.mjs             ← 만들고 .work/에만 남긴다 (기본: 저장 안 함)
//   node scripts/discover-split/run.mjs --angles    ← 각도만 뽑고 종료 (Exa·조립 안 씀)
//   node scripts/discover-split/run.mjs --material  ← 재료만 뽑고 종료 (LLM 안 태움, 공짜)
//   node scripts/discover-split/run.mjs --save      ← 원장(rudy.utterances)에도 넣는다
//
// ── 왜 이걸 또 만드나 (2026-07-30 유저 지시: "루프를 만들지 말고 똑같이 하는데 모델만 바꿔라")
//
// `discover-claude/`는 `claude -p`에 WebSearch를 줘서 **에이전트가 스스로 검색 루프를 돈다.**
// 2차 실행 실측: **28턴 · 933초 · 세션 사용량 39%.** 원장 단가로 가르면 캐시 쓰기 32% +
// 출력(사고) 27%가 1·2위였다 — 즉 **비싼 건 재료도 검색도 아니고 턴 수**다.
// 재료 37K를 한 번 넣는 값은 $0.11뿐이고, 28턴이 트랜스크립트를 계속 다시 청구한 게 값이었다.
//
// 그래서 이 스크립트는 **루프를 구조적으로 없앤다:**
//   · 각도 단계 `--allowedTools Read` — **WebSearch를 안 준다.** 검색 툴이 없으면 왕복할
//     이유가 없어서 1~2턴에 끝난다. (프롬프트로 "루프 돌지 마라"고 적는 게 아니라 툴을 뺀다.)
//   · 조립 단계도 같다. 검색 결과는 프롬프트에 인라인으로 박아서 준다.
//   · 재료 37K는 **각도 단계에만** 실린다. 조립 단계는 검색 결과만 본다 (여기가 절감 지점).
//
// ⚠️ **잃는 것 — 재시도 루프(RUDY-DISCOVERY §2-D "원샷 금지").** 검색이 리스티클만
//    물어온 각도를 살릴 방법이 없다. 완화책은 하나뿐이다: **각도를 12개 뽑아 8개를 쓴다**
//    (prompt-angles.md의 「개수」). 죽을 몫을 미리 얹는 것 — 이게 이 설계의 유일한 방어다.
//    그리고 조립이 재료를 못 보니 **검색 결과를 보고 각도를 다시 짜는 것도 불가능하다.**
//    이게 품질에 얼마나 영향을 주는지는 **실측 안 됐다** — 그걸 보려고 만든 스크립트다.
//
// **기존 파이프라인은 둘 다 안 건드린다.** `discovery` Edge Function도, `discover-claude/`도
// 그대로다. 재료 로더(`discover-claude/material.mjs`)와 Exa 호출(`_discovery-lib.mjs`)은
// **가져다 쓴다 — 복제하지 않는다.** 비교의 공정성이 거기 달려 있다(재료가 같아야 한다).
//
// 과금: 각도·조립은 `claude -p`라 **구독에 묻는다**(추가 청구 없음). Exa만 실제 청구되고
// 회당 $0.005~0.02 수준이다. OpenAI는 아예 안 쓴다 — 임베딩 게이트를 안 옮겼기 때문
// (RUDY-STATUS "중복 방지는 힌트만": 재료 안의 <이미 다룬 주제>가 그 역할을 한다).

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildMaterial, client } from '../discover-claude/material.mjs';
import { exaSearch } from '../_discovery-lib.mjs';

const HERE = new URL('.', import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const WORK = new URL('.work/', HERE);
const MODEL = process.env.DISCOVER_SPLIT_MODEL ?? 'claude-opus-5';
const NUM_RESULTS = 5;   // discovery/brief.ts와 같은 값 — 검색 조건을 프로덕션과 맞춘다
const HL_CHARS = 900;    // highlights 절단 길이. brief.ts와 동일

// 각도 상한 — 프롬프트를 믿지 않고 코드로 자른다(모델이 넘겨도 여기서 잘린다).
// 12를 뽑는 이유는 위 헤더 주석 참고: 재시도가 없으니 죽을 몫을 미리 얹는다.
const CAP = { expansion: 6, idea: 4, lens: 1, resurface: 1 };
const SLOTS = Object.keys(CAP);

const anglesOnly = process.argv.includes('--angles');
const materialOnly = process.argv.includes('--material');
const save = process.argv.includes('--save');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (...a) => console.log('[discover-split]', ...a);

mkdirSync(WORK, { recursive: true });

// ── 1. 재료 ──────────────────────────────────────────────────────────────────
const sb = client(); // .env를 process.env로 올린다 — EXA_API_KEY를 읽기 전에 먼저 불러야 한다
const { md, stats } = await buildMaterial(sb);
writeFileSync(new URL(`material-${stamp}.md`, WORK), md);
log('재료:', JSON.stringify(stats), `(${md.length}자)`);
if (materialOnly) process.exit(0);

const exaKey = process.env.EXA_API_KEY;
if (!exaKey && !anglesOnly) throw new Error('.env에 EXA_API_KEY 필요');

// 조립 단계에 넘길 중복 방지 블록. 재료의 마지막 두 구획(<이미 다룬 주제> + <이미 저장한 링크>)을
// 그대로 잘라 쓴다 — **조립은 재료 전체를 안 받으므로**(그게 절감 지점) 이 가드만 따로 넘긴다.
// ⚠️ material.mjs를 고쳐서 구조화 반환을 만들지 않았다: 저쪽은 discover-claude가 쓰는 파일이고
//    지금 필요한 건 문자열 한 조각뿐이다(§3 수술적 변경).
const guardsAt = md.indexOf('=== 이미 다룬 주제');
const guards = guardsAt >= 0 ? md.slice(guardsAt) : '';
if (!guards) log('⚠️ 재료에서 중복 방지 구획을 못 찾았다 — 조립이 가드 없이 돈다');

// ── claude -p 한 번 호출 = 1단계. 툴은 Read만 준다(= 검색 루프가 생길 수 없다) ──────────
async function runClaude(promptText, label) {
  const started = Date.now();
  log(`${label}: claude -p 실행 (model=${MODEL})`);
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--model', MODEL,
        '--output-format', 'json',
        // ⚠️ **WebSearch·WebFetch를 주지 않는다 — 이게 루프를 없애는 실제 장치다.**
        //    Read는 RUDY-DISCOVERY.md를 원본으로 읽히려고 남긴다(프롬프트 복제본을 안 늘린다).
        //    쓰기 툴도 없다 — 이 에이전트는 레포를 고치는 게 아니라 글을 쓰는 일만 한다.
        '--allowedTools', 'Read',
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
  // 턴 수는 이 설계의 핵심 지표다 — 루프판 28턴과 비교할 유일한 근거라서 반드시 찍는다.
  log(
    `${label} 완료 — ${Math.round((Date.now() - started) / 1000)}초 · ${json.num_turns}턴 · ` +
    `API환산 $${(json.total_cost_usd ?? 0).toFixed(3)} (구독이라 실청구는 0)`,
  );
  return { text: json.result ?? '', turns: json.num_turns ?? 0, cost: json.total_cost_usd ?? 0 };
}

// ── 2. 각도 ──────────────────────────────────────────────────────────────────
// 재료를 **프롬프트에 인라인**한다. discover-claude는 경로만 넘겨 모델이 Read하게 했는데,
// 여기선 인라인이 맞다: ① Read는 잘려 읽힐 수 있고 ② 파일을 읽는 왕복이 턴을 하나 더 만든다.
// (argv가 아니라 stdin으로 넘기므로 길이 제한에 안 걸린다.)
const anglePrompt = readFileSync(new URL('prompt-angles.md', HERE), 'utf8')
  .replace('{{MATERIAL}}', md);

const angleRun = await runClaude(anglePrompt, 'angles');
const angles = parseAngles(angleRun.text, stats.picked);
writeFileSync(new URL(`angles-${stamp}.json`, WORK), JSON.stringify(angles, null, 2));

const bySlot = SLOTS.map((s) => `${s} ${angles.filter((a) => a.slot === s).length}`).join(' · ');
log(`각도 ${angles.length}개 — ${bySlot}`);
for (const a of angles) {
  log(`  [${a.slot}] ${a.query || '(되꺼냄)'} ← ${a.from}${a.motive ? ` (동기: ${a.motive})` : ''}`);
}
if (!angles.length) throw new Error('각도가 0개 — .work/raw-angles 확인');
if (anglesOnly) { log('--angles — 여기서 끝'); process.exit(0); }

// 각도 JSON을 파싱한다. 모델이 규칙을 넘겨도 **코드가 자른다** (프롬프트를 신뢰하지 않는다).
function parseAngles(raw, pickedCount) {
  const body = raw.replace(/^\s*```(?:json)?/, '').replace(/```\s*$/, '').trim();
  // 서론이 붙어도 견딘다 — 프롬프트로 모델의 습관을 막으려 하지 말고 파서가 견딘다
  // (RUDY-STATUS 교훈). 첫 `{`부터 마지막 `}`까지만 본다.
  const s = body.indexOf('{');
  const e = body.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('각도 출력에서 JSON을 못 찾았다');
  let parsed;
  try {
    parsed = JSON.parse(body.slice(s, e + 1));
  } catch (err) {
    throw new Error(`각도 JSON 파싱 실패: ${err.message}`);
  }

  const clean = (parsed.angles ?? [])
    .filter((a) => a && SLOTS.includes(a.slot))
    .map((a) => ({
      slot: a.slot,
      query: typeof a.query === 'string' ? a.query.trim() : '',
      from: (a.from ?? '').toString().trim(),
      why: (a.why ?? '').toString().trim(),
      motive: a.slot === 'idea' && a.motive ? a.motive.toString().trim() : null,
      from_picked: a.from_picked === true,
    }))
    // resurface만 query가 없어도 된다. 나머지는 검색어가 없으면 쓸 수 없다.
    .filter((a) => a.slot === 'resurface' || a.query);

  // 지정 파편 컷 — 지정 하나당 각도 하나까지 (angles.ts와 같은 규칙).
  let picked = 0;
  const afterPicked = typeof pickedCount === 'number' && pickedCount > 0
    ? clean.filter((a) => !a.from_picked || ++picked <= pickedCount)
    : clean;

  // slot별 상한. 순서를 유지하며 앞에서부터 채운다.
  const seen = Object.fromEntries(SLOTS.map((s) => [s, 0]));
  return afterPicked.filter((a) => ++seen[a.slot] <= CAP[a.slot]);
}

// ── 3. 검색 (Exa) ────────────────────────────────────────────────────────────
// **병렬이다** — brief.ts와 같다. 순차로 돌 이유가 없고, 여기가 벽시계의 대부분이다.
// 각도 하나가 실패해도 나머지는 살린다(결과 없는 각도는 조립이 버린다).
let exaCost = 0;
const searched = await Promise.all(
  angles.map(async (angle) => {
    if (angle.slot === 'resurface' || !angle.query) return { angle, results: [] };
    try {
      const j = await exaSearch(exaKey, angle.query, NUM_RESULTS);
      exaCost += j.costDollars?.total ?? 0;
      const results = (j.results ?? []).map((r) => ({
        title: r.title ?? null,
        url: r.url,
        date: r.publishedDate?.slice(0, 10) ?? null,
        highlights: (r.highlights ?? []).join(' … ').slice(0, HL_CHARS),
      }));
      return { angle, results };
    } catch (e) {
      log(`  검색 실패 (${angle.query.slice(0, 40)}): ${e.message.slice(0, 60)}`);
      return { angle, results: [] };
    }
  }),
);
const hit = searched.filter((s) => s.results.length).length;
log(`검색 완료 — ${hit}/${angles.length}개 각도가 결과를 받았다 · Exa $${exaCost.toFixed(4)}`);

// 조립이 읽을 payload. brief.ts buildPayload와 같은 모양 — 각도의 from/why/motive를 같이 넘겨서
// 조립이 "어느 파편에서 나왔나"를 알 수 있게 한다 (조립은 재료를 안 받으므로 이게 유일한 출처다).
const payload = searched
  .map(({ angle, results }, i) => {
    const head = [
      `## 각도 ${i + 1} [${angle.slot}] ${angle.query || '(되꺼냄 — 검색 없음)'}`,
      `from: ${angle.from}`,
      `why: ${angle.why}`,
      ...(angle.motive ? [`motive: ${angle.motive}`] : []),
    ].join('\n');
    if (angle.slot === 'resurface') return `${head}\n(검색 없음 — 되꺼냄. 이 파편이 지금 왜 다르게 읽히는지만 써라.)`;
    if (!results.length) return `${head}\n(결과 없음 — 이 각도는 버려라.)`;
    return `${head}\n${results
      .map((r) => `- ${r.title ?? '(제목없음)'} | ${r.date ?? '날짜?'} | ${r.url}\n  ${r.highlights || '(발췌 없음)'}`)
      .join('\n')}`;
  })
  .join('\n\n');
writeFileSync(new URL(`payload-${stamp}.md`, WORK), payload);

// ── 4. 조립 ──────────────────────────────────────────────────────────────────
const assemblePrompt = readFileSync(new URL('prompt-assemble.md', HERE), 'utf8')
  .replace('{{GUARDS}}', guards)
  .replace('{{PAYLOAD}}', payload);

const assembleRun = await runClaude(assemblePrompt, 'assemble');

// ⚠️ 프롬프트로 모델의 마크업 습관을 막으려 하지 마라 — **파서가 견뎌야 한다** (RUDY-STATUS 교훈).
const cut = assembleRun.text.indexOf('###');
const text = (cut >= 0 ? assembleRun.text.slice(cut) : assembleRun.text).trim();
writeFileSync(new URL(`briefing-${stamp}.md`, WORK), text || assembleRun.text);

const items = (text.match(/^### /gm) ?? []).length;
const labels = ['확장', '아이디어', '관점', '되꺼냄']
  .map((l) => `${l} ${(text.match(new RegExp(`^### \\[${l}\\]`, 'gm')) ?? []).length}`)
  .join(' · ');
log(`브리핑 ${items}개 — ${labels}`);
log(`브리핑 파일: ${new URL(`briefing-${stamp}.md`, WORK).pathname}`);
log(
  `합계 — ${angleRun.turns + assembleRun.turns}턴 · ` +
  `API환산 $${(angleRun.cost + assembleRun.cost).toFixed(3)} + Exa $${exaCost.toFixed(4)}`,
);
log('  ↑ 루프판(discover-claude) 2차 실측은 28턴 · $2.30이었다 — 이게 비교 기준이다');

// ── 5. 저장 (기본 안 함) ─────────────────────────────────────────────────────
// ⚠️ **기본이 저장 안 함인 이유** — 이건 비교용이다. 원장에 넣으면 ① 다음 실행의 재료에
//    <이미 다룬 주제>로 들어가 **비교 조건이 바뀌고** ② 앱 발견 탭에서 루프판 결과와
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

// trigger='pull' — 이건 발견이지 아침 브리핑이 아니다 (discover-claude/run.mjs의 주석 참고).
// cost_usd — Exa만 실제 청구된다. claude -p는 구독에 묻으니 0이고, API 환산가를 적으면
// 원장이 거짓말을 한다. 그래서 Exa 실비만 적는다.
const { error } = await sb.schema('rudy').from('utterances').insert({
  surface: 'briefing', kind: 'discovery', text, trigger: 'pull', cost_usd: Number(exaCost.toFixed(4)),
});
if (error) throw new Error(`원장 저장 실패: ${error.message}`);
log('저장 완료 — 앱 발견 탭에서 보면 된다');

// 유저 지정을 소비한다 (한 번 나오고 끝 — 또 원하면 또 누른다).
// ⚠️ touch가 아니다: last_touched_at·touch_count를 안 건드리므로 §2-3은 지켜진다.
if (stats.picked) {
  await sb.from('fragments').update({ discover_next: false }).eq('discover_next', true);
  log(`지정 ${stats.picked}개 소비`);
}
