#!/usr/bin/env node
// 아침 브리핑 — 클코(claude -p) 한 방. **한 번 주고 한 번 뽑고 끝난다.**
//
//   node scripts/morning/run.mjs             ← 만들고 원장에 저장, 앱 데일리 상단에서 보면 된다
//   node scripts/morning/run.mjs --material  ← 재료만 뽑고 종료 (LLM 안 태움, 공짜)
//   node scripts/morning/run.mjs --no-save   ← 실험용. 저장 안 하고 .work/에만 남긴다
//
// ── 왜 Edge Function이 아니라 여기인가 (2026-08-02, 유저 지시)
//
// `supabase/functions/morning/`을 지우고 옮겼다. 발견(`discover-websearch/`)과 같은 모양이다 —
// 유저가 커맨드를 치고 앱에서 확인한다. 자동화 안 한다.
//
// 옮긴 이유는 비용이 아니다(아침은 API로도 월 $2였다). **재료를 다 읽을 수 있어서**다.
// API 판은 모델에 1,461토큰짜리 집계만 줬고 그래서 파편 386개 중 0개를 봤다.
// 여기선 전량을 그냥 준다. 2026-08-01 브리핑이 틀린 세 문장은 전부 "안 준 것" 때문이었다.
//
// ⚠️ **검색 툴을 안 준다.** 아침은 관찰이지 발견이 아니다(유저 확정 2026-07-29:
//    "아침 브리핑은 발견은 하지 말고 그냥 관찰 정도만"). WebSearch를 주면 발견이 딸려온다.
//
// ⚠️ 앱은 안 고쳐도 된다 — `src/lib/morning.ts fetchTodayMorning()`이 원장에서
//    `surface='briefing' AND kind='pattern'` 오늘 행을 읽어 화면을 그린다. 여기선 그 모양으로 한 행 넣는다.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildMorning, client, pickNudge, shape, vividness, MS_PER_DAY, TIMELINE_DAYS, RECENT_DAYS, PRIOR_DAYS } from './material.mjs';

const HERE = new URL('.', import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const WORK = new URL('.work/', HERE);
const MODEL = process.env.MORNING_MODEL ?? 'claude-opus-5';

const save = !process.argv.includes('--no-save');
const materialOnly = process.argv.includes('--material');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (...a) => console.log('[morning]', ...a);

mkdirSync(WORK, { recursive: true });

// ── 1. 재료
const now = new Date();
const sb = client();
const { md, stats, refs, rowById, toItem, meta } = await buildMorning(sb, now);
const materialPath = new URL(`material-${stamp}.md`, WORK);
writeFileSync(materialPath, md);
log('재료:', JSON.stringify(meta));
log('재료 파일:', materialPath.pathname);
if (materialOnly) process.exit(0);

// ── 2. 한 방
const prompt = readFileSync(new URL('prompt.md', HERE), 'utf8').replace('{{MATERIAL}}', materialPath.pathname);
log(`claude -p 실행 (model=${MODEL})`);
const started = Date.now();

const raw = await new Promise((resolve, reject) => {
  const child = spawn(
    'claude',
    [
      '-p',
      '--model', MODEL,
      '--output-format', 'json',
      // Read만 준다. 쓰기도 검색도 없다 — 재료 읽고 글 쓰는 게 전부인 일이다.
      '--allowedTools', 'Read',
    ],
    { cwd: ROOT.pathname, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`claude 종료 코드 ${code}`))));
  child.stdin.end(prompt);
});
writeFileSync(new URL(`raw-${stamp}.json`, WORK), raw);

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  throw new Error(`claude 출력이 JSON이 아니다 — .work/raw-${stamp}.json 확인`);
}
log(`${parsed.num_turns}턴 · ${Math.round((Date.now() - started) / 1000)}초 · API환산 $${(parsed.total_cost_usd ?? 0).toFixed(3)} (구독이라 실청구 0)`);

// 코드펜스를 프롬프트로 막으려 하지 마라 — **파서가 견딘다** (RUDY-STATUS 교훈).
const result = String(parsed.result ?? '');
const body = result.slice(result.indexOf('{'), result.lastIndexOf('}') + 1);
let out;
try {
  out = JSON.parse(body);
} catch {
  throw new Error(`본문이 JSON이 아니다 — .work/raw-${stamp}.json 확인`);
}

// ── 3. 조립. 모델은 번호(#N)로 말하고, 여기서 id로 되돌린다.
const idsOf = (list) =>
  [...new Set((Array.isArray(list) ? list : []).map((n) => refs[Number(n) - 1]).filter(Boolean))];
const itemsOf = (ids) => ids.map((id) => rowById.get(id)).filter(Boolean).map(toItem);

const recentCut = now.getTime() - RECENT_DAYS * MS_PER_DAY;
const priorCut = now.getTime() - PRIOR_DAYS * MS_PER_DAY;

// 축의 시간 모양·타임라인은 **코드가 계산한다.** 모델이 날짜에서 추론하게 두면
// "요즘 꽂혀 있네"를 근거 없이 말한다 (clusters.ts가 남긴 교훈).
const axes = (Array.isArray(out.axes) ? out.axes : [])
  .map((a) => {
    const rows = idsOf(a.refs).map((id) => rowById.get(id)).filter(Boolean);
    if (!rows.length || !a.label) return null;
    rows.sort((x, y) => x.created_at.localeCompare(y.created_at));
    const at = (f) => new Date(f.created_at).getTime();
    // 같은 날 여러 개면 제일 선명한 것으로 접는다 — 도트가 겹쳐도 정보는 하나다.
    const best = new Map();
    for (const f of rows) {
      const off = Math.floor((now.getTime() - at(f)) / MS_PER_DAY);
      if (off < 0 || off >= TIMELINE_DAYS) continue;
      best.set(off, Math.max(best.get(off) ?? 0, vividness(f, now)));
    }
    return {
      label: String(a.label).trim(),
      ...shape(rows.map((f) => f.created_at), now),
      count: rows.length,
      recent: rows.filter((f) => at(f) >= recentCut).length,
      prior: rows.filter((f) => at(f) < recentCut && at(f) >= priorCut).length,
      marks: [...best.entries()].map(([offset, v]) => ({ offset, vividness: v })).sort((x, y) => x.offset - y.offset),
      items: rows.map(toItem),
      stated: [],
    };
  })
  .filter(Boolean)
  .slice(0, 8);

const strings = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
// 프롬프트로 모델의 습관을 막으려 하지 마라 — **파서가 견딘다** (RUDY-STATUS 교훈).
//  ① 파편 링크: 걸지 말라고 했지만 걸어도 화면이 안 깨지게 마크업만 벗긴다.
//  ② `#N` 참조: 재료 안에서만 뜻이 있는 번호라 본문에 남으면 화면에선 뜻 없는 숫자다.
//     2026-08-01 첫 실행이 실제로 `(#5, #6)`·`(#28, #41…)`을 본문에 박았다. 프롬프트에도 금지를
//     넣었지만 여기서 한 번 더 벗긴다 — 괄호째 지우고, 남은 겹공백·문장부호 앞 공백을 정리한다.
const plain = (s) =>
  s
    .replace(/\[([^\]]+)\]\((?:mind|https?):\/\/[^)]+\)/g, '$1')
    .replace(/\s*[（(]\s*#\d+(?:\s*[,·、]\s*#\d+)*\s*[)）]/g, '')
    .replace(/\s*#\d+/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([,.;:)）])/g, '$1')
    .trim();

const written = {
  headline: typeof out.headline === 'string' ? plain(out.headline) : '',
  reading: strings(out.reading).map(plain),
  rejected: strings(out.rejected).map(plain),
};

const patternIds = idsOf(out.pattern?.refs);
const pattern = out.pattern?.text
  ? { kind: String(out.pattern.kind ?? '').trim(), text: plain(String(out.pattern.text)), items: itemsOf(patternIds) }
  : null;
const questionText = typeof out.question === 'string' ? plain(out.question) : '';

// ── 앞을 보는 카드들. 모델은 말만 쓰고 **짝·숫자는 재료가 이미 정한 것**이라
//    여기서 stats.ahead(코드 계산분)와 합친다. 모델이 근거를 못 대면 카드를 안 그린다.
const said = (v) => (v && typeof v.text === 'string' && v.text.trim()
  ? { text: plain(String(v.text)), items: itemsOf(idsOf(v.refs)) }
  : null);
const saidList = (v, cap) =>
  (Array.isArray(v) ? v : []).map(said).filter((x) => x && x.items.length).slice(0, cap);

const ahead = {
  nextMove: said(out.ahead?.nextMove),
  offWork: said(out.ahead?.offWork),
  crossLinks: saidList(out.ahead?.crossLinks, 2),
  revisits: saidList(out.ahead?.revisits, 3),
  // 코드가 끝낸 것 — 모델을 안 탄다. 화면이 그대로 그린다.
  floating: stats.ahead.floating,
  hot: stats.ahead.hot,
};

// 서사. `paras`가 비면 통째로 null — 문단 없는 확신도·반증은 뜻이 없다.
const CONF = ['거의 확실', '그럴듯함', '추측'];
const paras = (Array.isArray(out.narrative?.paras) ? out.narrative.paras : [])
  .filter((p) => p && typeof p.text === 'string' && p.text.trim())
  .map((p) => ({
    text: plain(String(p.text)),
    // 모델이 다른 말을 지어내도 화면이 안 깨지게 — 모르는 값은 제일 약한 쪽으로 접는다
    confidence: CONF.includes(p.confidence) ? p.confidence : '추측',
    items: itemsOf(idsOf(p.refs)),
  }));
const oneLine = (v) => (typeof v === 'string' && v.trim() ? plain(v) : null);
const narrative = paras.length
  ? {
      paras,
      changed: oneLine(out.narrative?.changed),
      revised: oneLine(out.narrative?.revised),
      counter: oneLine(out.narrative?.counter),
    }
  : null;

log(`헤드라인: ${written.headline}`);
log(`문단 ${written.reading.length} · 결 ${axes.length} · 패턴 ${pattern ? `${pattern.kind}(근거 ${pattern.items.length})` : '없음'} · 질문 ${questionText ? '있음' : '없음'}`);
log(
  `앞: 다음수 ${ahead.nextMove ? '있음' : '없음'} · 일말고 ${ahead.offWork ? '있음' : '없음'}` +
    ` · 연결 ${ahead.crossLinks.length} · 돌아온것 ${ahead.revisits.length} · 떠있는것 ${ahead.floating.length}`,
);
log(
  narrative
    ? `서사 ${narrative.paras.length}문단 (${narrative.paras.map((p) => p.confidence).join('/')})` +
        ` · 바뀜 ${narrative.changed ? '있음' : '없음'} · 고침 ${narrative.revised ? '있음' : '없음'}` +
        ` · 반증 ${narrative.counter ? '있음' : '없음'}`
    : '서사 없음',
);
writeFileSync(
  new URL(`brief-${stamp}.json`, WORK),
  JSON.stringify({ ...written, pattern, axes, question: questionText, ahead, narrative }, null, 2),
);

if (!save) {
  log('저장 안 함 (--no-save)');
  console.log(
    `\n${written.headline}\n\n${written.reading.join('\n\n')}\n\n[패턴] ${pattern?.text ?? '없음'}\n[질문] ${questionText || '없음'}\n` +
      `\n[다음 한 수] ${ahead.nextMove?.text ?? '없음'}\n[일 말고] ${ahead.offWork?.text ?? '없음'}\n` +
      `${ahead.crossLinks.map((c) => `[연결] ${c.text}`).join('\n')}\n` +
      `${ahead.revisits.map((r) => `[돌아옴] ${r.text}`).join('\n')}\n` +
      `\n── 서사 ──\n${narrative ? narrative.paras.map((p) => `(${p.confidence}) ${p.text}`).join('\n\n') : '없음'}\n` +
      `${narrative?.changed ? `\n[바뀐 것] ${narrative.changed}` : ''}` +
      `${narrative?.revised ? `\n[고친 판단] ${narrative.revised}` : ''}` +
      `${narrative?.counter ? `\n[반증] ${narrative.counter}` : ''}\n`,
  );
  process.exit(0);
}

// ── 4. 원장. 질문·넛지는 **각자 행을 갖는다** — 앱이 답을 그 행에 적어야 다시 열었을 때
//    이미 답한 게 되살아나지 않는다 (2026-08-01에 넛지가 정확히 그 버그를 냈다).
const insertUtterance = async (row) => {
  const { data, error } = await sb.schema('rudy').from('utterances').insert(row).select('id').single();
  if (error) throw new Error(`원장 저장 실패: ${error.message}`);
  return data.id;
};

let question = null;
if (questionText) {
  const text = questionText;
  question = {
    utteranceId: await insertUtterance({
      surface: 'briefing', kind: 'question', trigger: 'push',
      item_ids: patternIds, text,
    }),
    text,
  };
}

const picked = await pickNudge(sb, stats.nudgeCandidates, now);
let nudge = null;
if (picked) {
  nudge = {
    utteranceId: await insertUtterance({
      surface: 'briefing', kind: 'nudge', trigger: 'push',
      item_ids: [picked.fragmentId], text: picked.question,
    }),
    fragmentId: picked.fragmentId,
    question: picked.question,
  };
}

// cost_usd = 0. `claude -p`의 total_cost_usd는 API 환산가지 청구액이 아니라서
// 그대로 적으면 원장이 거짓말을 한다 (discover-websearch와 같은 판단).
await insertUtterance({
  surface: 'briefing', kind: 'pattern', trigger: 'push',
  item_ids: [], // 집계 발화라 "이 브리핑이 인용한 파편"이 따로 없다. 근거는 pattern.items에 있다
  text: JSON.stringify({
    ...written,
    pattern,
    axes,
    question,
    nudge,
    ahead,
    narrative, // 다음 실행이 재료로 받아서 **고쳐 쓴다** (material.mjs lastNarrative)
    stats: { ...stats, axes },
  }),
  cost_usd: 0,
});
log('저장 완료 — 앱 데일리 상단 아침 카드에서 보면 된다');
