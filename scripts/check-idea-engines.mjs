// 발견 브리핑 엔진 비교 — 검색 엔진·조립 모델을 바꿔가며 **같은 각도**로 나온 브리핑을 나란히 본다.
// 실제 세션(2026-07-22)에서 채팅의 Exa type=auto가 osmu.app·tistory 블로그(개념 설명)만 물어왔다 —
// 발견 브리핑이 같은 종류 질문에 Cluely·Revu·ReflexAI 같은 실물을 물어온 것과 대비된다.
//
//   node scripts/check-idea-engines.mjs           ← 구현된 모드 전부
//   node scripts/check-idea-engines.mjs auto      ← A: Exa type=auto (현재 프로덕션)
//   node scripts/check-idea-engines.mjs domain    ← B: Exa, HN·IndieHackers·Reddit만
//   node scripts/check-idea-engines.mjs company   ← C: Exa category=company
//   node scripts/check-idea-engines.mjs opus      ← D: A와 동일 검색 결과 + Claude Opus로 조립
//
// **재료·각도는 한 번만 뽑아서 전 모드가 공유한다** — 그래야 "검색 엔진/조립 모델" 차이만 보인다.
// (2026-07-23 유저 지시: "No phone 고정 말고 파편 기준으로 브리핑을 나란히") — check-brief.mjs와
// 완전히 같은 파이프라인(재료→각도→검색→조립)을 쓴다, 다만 검색·조립 단계에서만 갈라진다.
//
// ⚠️ 아직 실행 안 함(2026-07-23 작성, 내일 유저가 직접 실행). opus 모드는 .env에
//    ANTHROPIC_API_KEY 필요(console.anthropic.com에서 발급 — 지금 프로젝트엔 없음, 확인함).
//
// ⬜ E: Claude 자체 web_search 도구, F: GPT 자체 web_search 도구 — 아직 코드 없음.
//    각도+검색+거름이 한 호출에 통합되는 구조라 A~D와 달라서 API 형태부터 확인 후 만들 것.
// ⬜ "아이디어만 뽑는 각도" 모드는 여기 없음 — 별도 논의 중(2026-07-23), 결정되면 추가.

import {
  ANGLE_SYS, callOpenAI, loadEnv, loadMaterial, makeClient, parseAngles,
} from './_discovery-lib.mjs';

const MODE = process.argv[2];
const ANGLE_MODEL = 'gpt-5.5'; // 각도 결정은 실측대로 gpt-5.5 고정 (§8-1) — 이 스크립트가 바꾸는 건 검색·조립뿐
const NUM_RESULTS = 5;

const env = loadEnv();
if (!env.url || !env.role || !env.openai || !env.exa) {
  console.error('SUPABASE_URL/SERVICE_ROLE_KEY, OPENAI_API_KEY, EXA_API_KEY 전부 필요');
  process.exit(1);
}
const supabase = makeClient(env.url, env.role);

// brief.ts ASSEMBLE_SYS와 동일 (check-brief.mjs 미러) — 엔진 비교의 공정성을 위해 프로덕션과 동일 유지
const ASSEMBLE_SYS = `너는 Rudy다. 이 사람을 위해 바깥에서 찾아온 것들을 아침 브리핑으로 쓴다.
각 항목은 [각도]와 [그 각도로 검색한 결과들(highlights=본문 발췌)]로 주어진다.
**highlights를 실제로 읽고** 판단한다 — 제목만 보고 쓰지 마라.

## 거르는 법 (제일 중요 — 통과보다 거절이 신뢰를 만든다)
- **리스티클/SEO 쓰레기는 버린다.** "N Best…", "Top 10…", 어필리에이트 비교글. highlights에 알맹이(실물·1차 경험)가 없으면 버린다.
- **이 사람이 이미 저장했거나 이미 브리핑한 것과 겹치면 뺀다.** <이미 저장>·<이미 브리핑함>에 있는 걸 "발견"이라 하지 마라.
- **한 각도의 결과가 다 시원찮으면 그 항목을 통째로 버린다** (침묵 기본값 §2-8). 억지로 채우지 마라.
- 6~8개가 상한. 좋은 게 4개면 4개만 쓴다.

## 항목 하나의 모양 (짧게 — 주절주절 절대 금지)
### 제목 = 한 줄 발견. "이런 게 있다"가 아니라 "이게 너한테 뭐다"
제목 아래 **2~3문장으로 끝낸다.** 그 이상 쓰지 마라.
- 불릿으로 잘게 쪼개지 마라. 자연스럽게 이어지는 문장으로 쓴다.
- 뭔지 + 어느 파편에서 걸리는지 + 그래서 뭐가 흥미로운지를 한 흐름에 녹인다.
- 실물·구체는 문장 안에 자연스럽게 (누가 만들었나, 뭐가 다른가). 스펙 나열 금지.
- 추측이면 "내 추측인데" 한 번만.
- 문단 끝에 출처 2~3개: [짧은제목](url).

## 화법 (RUDY.md §2-b) — 사람이 말하듯
- 짧고 자연스럽게. 평서형 반말("~다","~어"). 아첨·느낌표·이모지·군더더기 금지.
- **제목만 읽어도 80%가 전달돼야 한다.** 본문은 그걸 뒷받침하는 두세 문장일 뿐.
- 프로덕트로만 쏠리지 마라 — 다른 갈래(관점·전시·트렌드)를 살려라.
- 되꺼냄(resurface)은 검색 결과가 없다. 그 파편이 지금 왜 다르게 읽히는지만 한두 문장.

## 브리핑 전체
- 항목 사이는 빈 줄 하나. 전체가 스크롤 두세 번에 끝나야 한다 — 길면 안 읽는다.
- 맨 위에 인삿말·서론 쓰지 마라. 바로 첫 항목(### )부터.
- 버리거나 못 찾은 게 있으면 **맨 끝에 ※ 로 시작하는 한 줄**로 짧게. 없으면 생략.

마크다운으로 쓴다. 항목 제목은 ### 로.`;

async function recentBriefContext() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase.schema('rudy').from('utterances').select('text')
    .eq('kind', 'discovery').eq('surface', 'briefing').gte('created_at', since);
  const texts = (data ?? []).map((r) => r.text ?? '');
  return {
    topics: texts.flatMap((t) => [...t.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim())),
    urls: texts.flatMap((t) => [...t.matchAll(/\((https?:\/\/[^)]+)\)/g)].map((m) => m[1])),
  };
}

async function exaSearchWith(query, opts = {}) {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': env.exa, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, type: 'auto', numResults: NUM_RESULTS, contents: { highlights: true }, ...opts }),
  });
  if (!res.ok) throw new Error(`Exa ${res.status}: ${await res.text()}`);
  return res.json();
}

async function callClaude(model, system, user) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY가 .env에 없다 — console.anthropic.com에서 발급.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 2048, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.content ?? []).map((b) => b.text ?? '').join('');
}

// 각도별로 검색해서 조립용 payload 문자열을 만든다. exaOpts로 엔진 변형을 바꿔 끼운다.
async function searchAngles(angles, exaOpts) {
  let exaCost = 0;
  const searched = [];
  for (const a of angles) {
    if (a.slot === 'resurface' || !a.query) { searched.push({ angle: a, results: [] }); continue; }
    try {
      const j = await exaSearchWith(a.query, exaOpts);
      exaCost += j.costDollars?.total ?? 0;
      const results = (j.results ?? []).map((r) => ({
        title: r.title, url: r.url, date: r.publishedDate?.slice(0, 10) ?? null,
        highlights: (r.highlights ?? []).join(' … ').slice(0, 900),
      }));
      searched.push({ angle: a, results });
    } catch (e) {
      console.log(`  검색 실패(${a.query.slice(0, 30)}): ${e.message.slice(0, 50)}`);
      searched.push({ angle: a, results: [] });
    }
  }
  return { searched, exaCost };
}

function buildPayload(searched) {
  return searched
    .map(({ angle, results }, i) => {
      const head = `## 각도 ${i + 1} [${angle.slot}] ${angle.query || '(되꺼냄)'}\nfrom: ${angle.from}\nwhy: ${angle.why}`;
      if (angle.slot === 'resurface') return `${head}\n(검색 없음 — 되꺼냄.)`;
      const body = results.length
        ? results.map((r) => `- ${r.title ?? '(제목없음)'} | ${r.date ?? '날짜?'} | ${r.url}\n  ${r.highlights || '(발췌 없음)'}`).join('\n')
        : '(결과 없음)';
      return `${head}\n${body}`;
    })
    .join('\n\n');
}

// 검색 엔진 변형 (A/B/C) — 조립은 항상 gpt-5.5
const ENGINE_VARIANTS = {
  auto: { note: 'Exa type=auto (현재 프로덕션)', exaOpts: {} },
  domain: {
    note: 'Exa, HN·IndieHackers·Reddit만',
    exaOpts: { includeDomains: ['news.ycombinator.com', 'indiehackers.com', 'reddit.com'] },
  },
  company: { note: 'Exa category=company', exaOpts: { category: 'company' } },
};

async function main() {
  if (MODE && !ENGINE_VARIANTS[MODE] && MODE !== 'opus') {
    console.error(`모르는 모드: ${MODE}. 가능: ${[...Object.keys(ENGINE_VARIANTS), 'opus'].join(', ')}`);
    process.exit(1);
  }

  // 재료·각도는 딱 한 번 — 모든 모드가 공유한다 (검색·조립 차이만 보이게)
  const { block: rawBlock, saved } = await loadMaterial(supabase);
  const prior = await recentBriefContext();
  const block = rawBlock + (prior.topics.length ? `\n\n<이미 다룬 주제 (다시 꺼내지 마라)>\n${prior.topics.join(' / ')}` : '');
  process.stdout.write('각도 뽑는 중 (gpt-5.5, 전 모드 공유)… ');
  const angles = parseAngles(await callOpenAI(env.openai, ANGLE_MODEL, ANGLE_SYS, block));
  console.log(`${angles.length}개`);
  for (const a of angles) console.log(`  [${a.slot}] ${a.query || '(되꺼냄)'} ← ${a.from}`);

  const savedBlock = `<이미 저장>\n${saved.join(' / ')}\n</이미 저장>`;
  const priorBlock = prior.urls.length ? `<이미 브리핑함>\n${prior.urls.join(' / ')}\n</이미 브리핑함>` : '';

  // A: auto 검색 결과는 opus 모드(D)가 재사용한다 — 검색은 고정, 조립 모델만 비교
  let autoSearched = null;

  const runEngine = async (name) => {
    const { note, exaOpts } = ENGINE_VARIANTS[name];
    console.log(`\n${'='.repeat(70)}\n[${name}] ${note}\n${'='.repeat(70)}`);
    const { searched, exaCost } = await searchAngles(angles, exaOpts);
    if (name === 'auto') autoSearched = searched;
    const payload = buildPayload(searched);
    const user = [savedBlock, priorBlock, `<검색결과>\n${payload}\n</검색결과>`].filter(Boolean).join('\n\n');
    const brief = await callOpenAI(env.openai, ANGLE_MODEL, ASSEMBLE_SYS, user);
    console.log(brief);
    console.log(`\nExa 비용 $${exaCost.toFixed(3)}`);
  };

  const runOpus = async () => {
    console.log(`\n${'='.repeat(70)}\n[opus] auto와 동일 검색 결과 + Claude Opus 조립\n${'='.repeat(70)}`);
    if (!autoSearched) {
      const { searched } = await searchAngles(angles, {});
      autoSearched = searched;
    }
    const payload = buildPayload(autoSearched);
    const user = [savedBlock, priorBlock, `<검색결과>\n${payload}\n</검색결과>`].filter(Boolean).join('\n\n');
    const brief = await callClaude('claude-opus-4-8', ASSEMBLE_SYS, user);
    console.log(brief);
  };

  const modes = MODE ? [MODE] : [...Object.keys(ENGINE_VARIANTS), 'opus'];
  for (const m of modes) {
    if (m === 'opus') await runOpus();
    else await runEngine(m);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('판단: 항목마다 O/X. 리스티클 걸러졌나? 실물(제품·회사)이 나왔나? 개념 설명 블로그만 나온 모드는?');
}

main().catch((e) => {
  console.error('\n실패:', e.message ?? e);
  process.exit(1);
});
