#!/usr/bin/env node
// 발견 두 판을 **같은 조건에서** 나란히 돌려 시간·비용·퀄리티 지표를 뽑는다.
//
//   node scripts/compare-discover.mjs           ← 둘 다 돌리고 비교표 + 브리핑 두 개
//   node scripts/compare-discover.mjs --dry     ← 안 돌리고 마지막 결과만 다시 분석
//
//   ⏱ 20분쯤 걸린다 (채택판 6~11분 + 병렬판 6분). 백그라운드로 던지고 딴 거 해라.
//
// ── 공정성 장치 (여기가 이 스크립트의 전부다)
//
// ① **둘 다 `--no-save`로 돌린다.** 이걸 안 지키면 먼저 돈 판이 원장에 들어가고, 그게
//    다음 판의 재료 <이미 다룬 주제>에 섞여 **뒤에 도는 쪽만 불리해진다.** 채택판은 기본이
//    저장이라 반드시 플래그를 줘야 한다(`discover-websearch/run.mjs:43`).
// ② **순차로 돈다.** 동시에 던지면 서로 레이트리밋·CPU를 뺏어서 시간 측정이 무의미해진다.
//    이 스크립트가 재는 게 시간이라 이건 타협 못 한다.
// ③ **두 판의 재료를 둘 다 저장해 실제로 같았는지 확인한다.** 각 판이 자기 시점에 DB에서
//    새로 뽑기 때문에 20분 사이에 유저가 파편을 넣으면 조건이 어긋난다. 어긋났으면 표에
//    경고가 뜬다 — 그럼 그 회차는 버려라.
//
// ⚠️ **퀄리티는 자동으로 안 재진다.** 아래 지표는 **읽기 전에 보는 참고치**지 판정이 아니다.
//    최종 판단은 사람이 브리핑 두 개를 나란히 읽고 한다. 그래서 맨 끝에 둘 다 통째로 찍는다.
//
// ⚠️ 채택판을 **먼저** 돌린다(기준선). 뒤에 도는 쪽이 프롬프트 캐시로 조금 유리할 수 있는데,
//    그 이득은 병렬판 쪽에 붙는다 — 즉 이 배치는 **병렬판에 관대하다.** 결과를 읽을 때 감안해라.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('.compare/', new URL('./', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dry = process.argv.includes('--dry');
const log = (...a) => console.log('[compare]', ...a);

const PIPES = [
  { key: 'discover', name: '채택판 (discover-websearch)', dir: 'scripts/discover-websearch', args: ['--no-save'] },
  { key: 'discover:p', name: '병렬판 (discover-parallel)', dir: 'scripts/discover-parallel', args: [] },
];

mkdirSync(OUT, { recursive: true });

// ── 실행 ─────────────────────────────────────────────────────────────────────
function run(pipe) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    log(`▶ ${pipe.name} 시작`);
    const child = spawn('node', [`${pipe.dir}/run.mjs`, ...pipe.args], {
      cwd: ROOT.pathname,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      const secs = Math.round((Date.now() - started) / 1000);
      log(`■ ${pipe.name} 끝 — 벽시계 ${secs}초 (종료코드 ${code})`);
      // 종료코드가 0이 아니어도 죽이지 않는다 — 한쪽이 실패해도 다른 쪽 결과는 봐야 한다.
      resolve({ secs, code, stdout: out, since: started });
    });
  });
}

// ── 그 실행이 남긴 파일만 긁는다 ─────────────────────────────────────────────
// **mtime이 아니라 스탬프로 묶는다.** 두 판 다 파일명에 실행 스탬프를 박으니 그게 실행 단위의
// 정확한 경계다(`material-<stamp>.md` · `raw-<stamp>.json` · `raw-<label>-<stamp>.json`).
// mtime으로 하면 `--dry`가 과거 회차까지 전부 합산해버린다 — 실제로 그렇게 터졌다.
// 재료 파일을 기준으로 삼는 이유: 제일 먼저 쓰이므로 실행이 중간에 죽어도 남아 있다.
function collect(pipe) {
  const work = new URL(`${pipe.dir}/.work/`, ROOT);
  if (!existsSync(work)) return null;
  const files = readdirSync(work);
  const mats = files.filter((f) => f.startsWith('material-')).sort();
  if (!mats.length) return null;
  const stamp = mats.at(-1).replace('material-', '').replace('.md', '');
  const mine = (prefix) => files.filter((f) => f.startsWith(prefix) && f.includes(stamp)).sort();

  let out = 0, cacheW = 0, cacheR = 0, cost = 0, turns = 0, calls = 0, searches = 0;
  for (const f of mine('raw-')) {
    let j;
    try { j = JSON.parse(readFileSync(new URL(f, work), 'utf8')); } catch { continue; }
    const u = j.usage ?? {};
    out += u.output_tokens ?? 0;
    cacheW += u.cache_creation_input_tokens ?? 0;
    cacheR += u.cache_read_input_tokens ?? 0;
    cost += j.total_cost_usd ?? 0;
    turns += j.num_turns ?? 0;
    calls++;
    for (const m of Object.values(j.modelUsage ?? {})) searches += m.webSearchRequests ?? 0;
  }

  const briefFile = mine('briefing-').pop();
  return {
    stamp, out, cacheW, cacheR, cost, turns, calls, searches,
    brief: briefFile ? readFileSync(new URL(briefFile, work), 'utf8') : '',
    material: readFileSync(new URL(`material-${stamp}.md`, work), 'utf8'),
  };
}

// ── 퀄리티 참고치 (판정 아님) ────────────────────────────────────────────────
function metrics(brief, material) {
  const lines = brief.split('\n');
  const titles = lines.filter((l) => l.startsWith('### ')).map((l) => l.replace(/^### /, ''));
  const slots = ['확장', '아이디어', '관점', '되꺼냄']
    .map((l) => [l, titles.filter((t) => t.startsWith(`[${l}]`)).length]);

  // 링크 수 — 항목당 몇 개나 붙었나. 얇은 브리핑은 여기서 먼저 드러난다.
  const links = (brief.match(/\]\(https?:\/\//g) ?? []).length;

  // 중복률 — 재료의 <이미 다룬 주제>와 제목 토큰이 얼마나 겹치나.
  // ⚠️ 과소집계된다("SmartKnob"과 "햅틱 노브"는 글자가 달라 0으로 나온다). 하한선으로만 봐라.
  const at = material.indexOf('=== 이미 다룬 주제');
  const end = material.indexOf('=== 이미 저장한 링크');
  const prior = at >= 0
    ? material.slice(at, end > at ? end : undefined).split('\n')
        .filter((l) => l.startsWith('  - ')).map((l) => l.slice(4))
    : [];
  const stop = new Set(['이제', '아니라', '있다', '없다', '것이', '그게', '지금', '하는', '되는', '쪽이', '한다', '자리는', '말고', '전부', '이미', '보다', '그리고', '대신', '건데']);
  const tok = (s) => new Set(s.replace(/[^\w가-힣]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !stop.has(w)));
  const dup = titles.filter((t) => {
    const a = tok(t.replace(/^\[[^\]]+\]\s*/, ''));
    return prior.some((p) => {
      const b = tok(p);
      return [...a].filter((x) => b.has(x)).length / Math.min(a.size, b.size) >= 0.3;
    });
  });

  // 본문 길이 — 항목당 몇 자나 쓰나 (얕은 항목 탐지).
  const body = brief.replace(/^### .*$/gm, '').replace(/^※.*$/gm, '').trim().length;

  return {
    items: titles.length,
    slots: slots.map(([l, n]) => `${l} ${n}`).join(' · '),
    links, perItem: titles.length ? (links / titles.length).toFixed(1) : '0',
    dup: dup.length, dupTitles: dup,
    bodyPerItem: titles.length ? Math.round(body / titles.length) : 0,
    priorCount: prior.length,
  };
}

// ── 본 진행 ──────────────────────────────────────────────────────────────────
const results = [];
for (const pipe of PIPES) {
  const r = dry ? { secs: null } : await run(pipe);
  const c = collect(pipe);
  if (!c) { log(`⚠️ ${pipe.name}의 .work를 못 읽었다 — 건너뛴다`); continue; }
  results.push({ pipe, secs: r.secs, ...c, m: metrics(c.brief, c.material) });
}

if (results.length < 2) { log('비교할 게 둘이 안 된다 — 위 에러 확인'); process.exit(1); }

// 재료가 실제로 같았나 — 이게 어긋나면 아래 표를 믿으면 안 된다.
const [a, b] = results;
const sameMaterial = a.material.length === b.material.length;
const fmt = (n) => n.toLocaleString();

const table = [
  '',
  '═'.repeat(78),
  `발견 파이프라인 비교 — ${stamp}`,
  '═'.repeat(78),
  sameMaterial
    ? `재료: 두 판 모두 ${fmt(a.material.length)}자 (동일 ✅) · <이미 다룬 주제> ${a.m.priorCount}개`
    : `⚠️ 재료가 다르다 — ${fmt(a.material.length)}자 vs ${fmt(b.material.length)}자.\n` +
      `   실행 사이에 파편이 바뀌었다. 조건이 어긋났으니 이 회차는 참고만 해라.`,
  '',
  ['', ...results.map((r) => r.pipe.key.padStart(14))].join(' │ '),
  '─'.repeat(78),
  ...[
    ['벽시계', (r) => (r.secs == null ? '—' : `${r.secs}초`)],
    ['LLM 호출', (r) => `${r.calls}개`],
    ['턴 합계', (r) => `${r.turns}턴`],
    ['출력 토큰', (r) => fmt(r.out)],
    ['캐시 쓰기', (r) => fmt(r.cacheW)],
    ['캐시 읽기', (r) => fmt(r.cacheR)],
    ['API환산 $', (r) => `$${r.cost.toFixed(2)}`],
    ['웹검색', (r) => `${r.searches}회`],
    ['', () => ''],
    ['항목 수', (r) => `${r.m.items}개`],
    ['slot 구성', (r) => r.m.slots],
    ['링크/항목', (r) => `${r.m.perItem} (총 ${r.m.links})`],
    ['본문 자수/항목', (r) => `${r.m.bodyPerItem}자`],
    ['중복 의심', (r) => `${r.m.dup}개`],
  ].map(([label, f]) => [label.padEnd(14), ...results.map((r) => String(f(r)).padStart(14))].join(' │ ')),
  '═'.repeat(78),
  '',
  '※ 위 숫자 중 퀄리티를 실제로 말해주는 건 없다. 중복 의심은 과소집계고(글자가 다르면 못 잡는다),',
  '  링크·자수는 밀도지 값어치가 아니다. **아래 브리핑 두 개를 직접 읽고 판단해라.**',
  '',
].join('\n');

console.log(table);
for (const r of results) {
  if (r.m.dup) {
    console.log(`[${r.pipe.key}] 중복 의심 제목:`);
    for (const t of r.m.dupTitles) console.log(`   🔴 ${t}`);
    console.log('');
  }
}

const report = [
  table,
  ...results.flatMap((r) => ['', '━'.repeat(78), `### ${r.pipe.name} — ${r.secs}초 · $${r.cost.toFixed(2)}`, '━'.repeat(78), '', r.brief]),
].join('\n');

writeFileSync(new URL(`compare-${stamp}.md`, OUT), report);
log(`저장: scripts/.compare/compare-${stamp}.md`);
console.log(report.slice(table.length));
