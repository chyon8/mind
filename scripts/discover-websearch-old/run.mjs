#!/usr/bin/env node
// 발견 — 지금 채택판(`discover-websearch`)의 **RUDY-DISCOVERY 501줄 원본판**.
// 2026-08-04, 유저가 "예전 기준 문서로도 돌려보고 싶다"고 해서 만들었다.
//
// `discover-websearch/`를 **그대로 복사**해서 딱 하나만 바꿨다 — prompt.md가 읽는 기준
// 문서를 `RUDY-DISCOVERY.md`(201줄, 지금 기준) 대신 `RUDY-DISCOVERY-OLD.md`(501줄, 2026-08-02
// 자르기 전 스냅샷, 루트에 얼려둠)로 지정. 나머지 로직·모델·재시도 정책은 채택판과 동일 —
// 그래야 "문서가 501줄이면 달라지나"만 순수하게 비교된다.
//
//   node scripts/discover-websearch-old/run.mjs             ← 만들고 원장에 저장, 앱에서 보면 된다
//   node scripts/discover-websearch-old/run.mjs --material  ← 재료만 뽑고 종료 (LLM 안 태움, 공짜)
//   node scripts/discover-websearch-old/run.mjs --no-save   ← 저장 안 하고 .work/에만 남긴다
//
// ⚠️ **채택판과 똑같이 `discover_next`(다음 발견에 포함) 지정을 소비하고 끈다.** 지금 지정된
//    파편이 있으면 이 판을 돌려도 그게 없어진다 — 비교만 하고 싶으면 먼저 `--material`로
//    재료만 보거나, 지정을 잠깐 없는 상태에서 돌려라.
//
// ⚠️ 실행 결과는 stdout에만 남으면 사라진다 (RUDY-STATUS 교훈) — 재료·원출력을 `.work/`에
//    타임스탬프로 남긴다.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// 재료 로더는 `discover-claude/`의 것을 그대로 쓴다 — 재료 자체는 비교 변수가 아니다.
import { buildMaterial, client } from '../discover-claude/material.mjs';

const HERE = new URL('.', import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const WORK = new URL('.work/', HERE);
const MODEL = process.env.DISCOVER_WS_MODEL ?? 'claude-opus-5';

// 기본이 저장이다 — 채택판과 같은 기본값(다른 값이면 "안 켜서 그런가"가 비교에 섞인다).
const save = !process.argv.includes('--no-save');
const materialOnly = process.argv.includes('--material');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (...a) => console.log(`[discover-ws-old]`, ...a);

mkdirSync(WORK, { recursive: true });

// ── 1. 재료
const sb = client();
const { md, stats } = await buildMaterial(sb);
const materialPath = new URL(`material-${stamp}.md`, WORK);
writeFileSync(materialPath, md);
log('재료:', JSON.stringify(stats));
log('재료 파일:', materialPath.pathname, `(${md.length}자)`);
// 지정 상태를 맨 앞에서 못박는다 — 0인지 쿼리가 조용히 실패한 건지 구분이 안 되던 자리다.
log(stats.picked ? `⭐ 유저 지정 ${stats.picked}개 — 반드시 항목으로 나와야 한다` : '유저 지정 없음 (앱에서 "다음 발견에 포함"을 누르면 여기 뜬다)');
if (materialOnly) process.exit(0);

// ── 2. 에이전트
// 프롬프트는 prompt.md에 있다 — 코드를 안 건드리고 기준을 고칠 수 있게 뺐다.
// `{{MATERIAL}}`만 실제 경로로 갈아끼운다. 재료를 프롬프트에 인라인하지 않는 이유:
// 25k 토큰짜리를 argv로 넘기면 길이 제한에 걸리고, 파일이면 에이전트가 다시 읽을 수도 있다.
const prompt = readFileSync(new URL('prompt.md', HERE), 'utf8')
  .replace('{{MATERIAL}}', materialPath.pathname);

log(`claude -p 실행 (model=${MODEL}) — 검색 루프를 도니 몇 분 걸린다`);
const started = Date.now();

const raw = await new Promise((resolve, reject) => {
  const child = spawn(
    'claude',
    [
      '-p',
      '--model', MODEL,
      '--output-format', 'json',
      // Read = RUDY-DISCOVERY.md·재료 / WebSearch·WebFetch = 바깥 찾기.
      // 쓰기 툴은 안 준다 — 이 에이전트는 레포를 고치는 게 아니라 글을 쓰는 일만 한다.
      '--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch',
    ],
    { cwd: ROOT.pathname, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.on('error', reject);
  child.on('close', (code) =>
    code === 0 ? resolve(out) : reject(new Error(`claude 종료 코드 ${code}`)),
  );
  child.stdin.end(prompt);
});

writeFileSync(new URL(`raw-${stamp}.json`, WORK), raw);

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  throw new Error(`claude 출력이 JSON이 아니다 — .work/raw-${stamp}.json 확인`);
}
const result = parsed.result ?? '';
// 턴 수가 이 판의 핵심 지표다 — 루프판 28턴과 비교할 유일한 근거라서 반드시 찍는다.
log(
  `${parsed.num_turns}턴 · API환산 $${(parsed.total_cost_usd ?? 0).toFixed(3)} (구독이라 실청구는 0)` +
  `  ← 루프판 2차 실측은 28턴 · $2.30`,
);

// ⚠️ 프롬프트로 모델의 마크업 습관을 막으려 하지 마라 — **파서가 견뎌야 한다** (RUDY-STATUS 교훈).
// "서론 쓰지 마라"라고 적어놔도 붙을 수 있으니 첫 `###`부터 잘라낸다.
const cut = result.indexOf('###');
const text = (cut >= 0 ? result.slice(cut) : result).trim();

const briefPath = new URL(`briefing-${stamp}.md`, WORK);
writeFileSync(briefPath, text || result);
log(`완료 — ${Math.round((Date.now() - started) / 1000)}초 · 항목 ${(text.match(/^### /gm) ?? []).length}개`);
log('브리핑 파일:', briefPath.pathname);

// ── 3. 저장
if (!text || text === '(없음)') {
  log('볼 게 없다 — 저장 안 함 (§2-8 침묵 기본값)');
  process.exit(0);
}
if (!save) {
  log('저장 안 함 (--no-save)');
  console.log(`\n${text}\n`);
  process.exit(0);
}

// trigger='pull' — **이건 발견이지 아침 브리핑이 아니다.**
// ⚠️ 처음엔 'push'로 잡았다가 되돌렸다(2026-07-29, 유저 지적). 'push'는 앱에서 "아침" 배지가
//    되는데, 같은 날 유저가 **"아침 브리핑은 발견은 빼고 관찰만"**으로 정했다. 발견을 아침이라고
//    라벨링하면 그 결정과 정면으로 어긋난다. 'push'를 밀었던 이유(모닝 버튼이 잠겨 중복 지출
//    방지)는 부수 효과였고, 아침이 관찰 전용이 되면 그 버튼 자체가 없어질 자리다.
//    → 아침 브리핑을 만들 때 **그때 새 표면을 쓴다.** 발견은 발견으로 남는다.
// cost_usd=0 — 구독에 묻어서 돌면 추가 과금이 없다. `claude -p`가 돌려주는 total_cost_usd는
//   API 환산가지 청구액이 아니라서 적으면 원장이 거짓말을 한다. (API 과금 방식이면 바꿔야 한다.)
const { error } = await sb.schema('rudy').from('utterances').insert({
  surface: 'briefing', kind: 'discovery', text, trigger: 'pull', cost_usd: 0,
});
if (error) throw new Error(`원장 저장 실패: ${error.message}`);
log('저장 완료 — 앱 발견 탭에서 보면 된다');

// 유저 지정을 소비한다 (한 번 나오고 끝 — 또 원하면 또 누른다).
// ⚠️ 유저 확정 2026-07-30: **자동으로 내린다.** 앱에서 일일이 찾아 끄는 건 불가능하다.
//    대신 "지정했는데 항목이 안 나오고 표시만 사라지는" 사고는 프롬프트로 막는다 —
//    `prompt.md`의 「개수」 절에 "지정에서 나온 각도는 절대 버리지 마라, 못 찾았으면
//    못 찾았다고 쓰되 항목은 내라"가 들어 있다. 여기서 검증할 방법은 없다(출력이 마크다운이라
//    어느 항목이 어느 지정에서 왔는지 코드가 못 짚는다 — `brief.ts:377`이 인정한 그 한계).
// ⚠️ touch가 아니다: last_touched_at·touch_count를 안 건드리므로 §2-3은 지켜진다.
if (stats.picked) {
  const { error: pe } = await sb
    .from('fragments')
    .update({ discover_next: false, discover_next_slot: null })
    .eq('discover_next', true);
  if (pe) log(`⚠️ 지정 해제 실패: ${pe.message}`);
  else log(`지정 ${stats.picked}개 소비 (표시 내림)`);
}
