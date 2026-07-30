#!/usr/bin/env node
// 클코 발견 — 맥에서 `claude -p`로 브리핑을 만들어 `rudy.utterances`에 넣는다.
//
//   node scripts/discover-claude/run.mjs            ← 만들고 저장
//   node scripts/discover-claude/run.mjs --dry      ← 만들되 저장 안 함 (프롬프트 튜닝용)
//   node scripts/discover-claude/run.mjs --material ← 재료만 뽑고 종료 (LLM 안 태움, 공짜)
//
// **기존 파이프라인은 하나도 안 건드린다** (유저 지시 2026-07-29). `discovery` Edge Function도,
// `angles.ts`·`brief.ts`·`dedupe.ts`도, 앱도 그대로다. 앱은 `rudy.utterances`를 읽을 뿐이라
// **UI 변경이 0이다** — 발견 탭을 열면 새 행이 그냥 목록에 있다.
//
// 왜 옮기나 (RUDY-STATUS "클코 이관"):
//   · **원리 D(재시도 루프)가 공짜로 들어온다.** 기존은 각도→검색 1회→조립이라 루프가 없다.
//   · **RUDY-DISCOVERY.md를 원본 그대로 읽힌다** — 프롬프트 복제본이 안 늘어난다.
//   · 비용이 구독에 묻는다. 단 이건 부수 효과지 이유가 아니다.
//
// ⚠️ 실행 결과는 stdout에만 남으면 사라진다 (RUDY-STATUS 교훈) — 재료·원출력을 `.work/`에
//    타임스탬프로 남긴다. 프롬프트를 고칠 때 뭐가 달랐는지 비교할 유일한 근거다.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildMaterial, client } from './material.mjs';

const HERE = new URL('.', import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const WORK = new URL('.work/', HERE);
const MODEL = process.env.DISCOVER_CLAUDE_MODEL ?? 'claude-opus-5';

const dry = process.argv.includes('--dry');
const materialOnly = process.argv.includes('--material');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (...a) => console.log(`[discover-claude]`, ...a);

mkdirSync(WORK, { recursive: true });

// ── 1. 재료
const sb = client();
const { md, stats } = await buildMaterial(sb);
const materialPath = new URL(`material-${stamp}.md`, WORK);
writeFileSync(materialPath, md);
log('재료:', JSON.stringify(stats));
log('재료 파일:', materialPath.pathname, `(${md.length}자)`);
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

let result;
try {
  result = JSON.parse(raw).result ?? '';
} catch {
  throw new Error(`claude 출력이 JSON이 아니다 — .work/raw-${stamp}.json 확인`);
}

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
if (dry) {
  log('--dry — 저장 안 함');
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
// ⚠️ touch가 아니다: last_touched_at·touch_count를 안 건드리므로 §2-3은 지켜진다.
if (stats.picked) {
  await sb.from('fragments').update({ discover_next: false }).eq('discover_next', true);
  log(`지정 ${stats.picked}개 소비`);
}
