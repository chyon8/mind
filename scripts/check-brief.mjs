// 발견 브리핑 전 과정을 앱 없이 뽑는다 — 재료 → 각도(gpt-5.5) → Exa 검색 → 조립(gpt-5.5).
//   node scripts/check-brief.mjs           ← 실제 브리핑 하나
//   node scripts/check-brief.mjs --angles-only   ← 검색·조립 안 하고 각도만 (Exa 비용 0)
//
// 이게 발견의 실제 산출물이다. 여기서 나온 걸 유저가 O/X 하면 그게 렌즈·프롬프트의 튜닝 근거다.
// RUDY-DISCOVERY.md의 렌즈·원리·통한 예시가 프롬프트에 반영돼 있다 — 그 문서가 기준이다.

import {
  ANGLE_SYS, callOpenAI, exaSearch, loadEnv, loadMaterial, makeClient, parseAngles,
} from './_discovery-lib.mjs';

const ANGLES_ONLY = process.argv.includes('--angles-only');
const MODEL = 'gpt-5.5'; // 발견은 모델빨 (§8-1 실측). 조립도 각도와 같은 모델이어야 한다.
const NUM_RESULTS = 5;

const env = loadEnv();
if (!env.url || !env.role || !env.openai) { console.error('SUPABASE/OPENAI 키 필요'); process.exit(1); }
if (!ANGLES_ONLY && !env.exa) { console.error('EXA_API_KEY 필요 (또는 --angles-only)'); process.exit(1); }
const supabase = makeClient(env.url, env.role);

// ── discovery/brief.ts로 포팅할 조립 프롬프트 (검색 결과를 읽고 브리핑을 쓴다) ──────────
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
- 버리거나 못 찾은 게 있으면 **맨 끝에 ※ 로 시작하는 한 줄**로 짧게(§2-b). 예: \`※ 더현대 팝업은 리스티클이라 뺐다.\`
  이 줄은 카드가 아니라 각주다 — 반드시 ※ 로 시작하고, 항목(###) 본문에 섞지 마라. 없으면 생략.

마크다운으로 쓴다. 항목 제목은 ### 로.`;
// ────────────────────────────────────────────────────────────────────────────

// 최근 30일 브리핑에서 다룬 주제(###)·URL — 반복 방지 (brief.ts recentBriefContext 미러)
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

async function main() {
  const { block: rawBlock, saved } = await loadMaterial(supabase);
  const prior = await recentBriefContext();
  const block = rawBlock + (prior.topics.length ? `\n\n<이미 다룬 주제 (다시 꺼내지 마라)>\n${prior.topics.join(' / ')}` : '');
  if (prior.topics.length) console.log(`(이미 다룬 주제 ${prior.topics.length}개 회피)`);
  process.stdout.write('각도 뽑는 중 (gpt-5.5)… ');
  const angles = parseAngles(await callOpenAI(env.openai, MODEL, ANGLE_SYS, block));
  console.log(`${angles.length}개`);

  if (ANGLES_ONLY) {
    for (const a of angles) console.log(`  [${a.slot}] ${a.query || '(되꺼냄)'} ← ${a.from}`);
    return;
  }

  // 각도별 Exa 검색 (되꺼냄은 검색 안 함 — 코퍼스에서 나온 것)
  let exaCost = 0;
  const searched = [];
  for (const a of angles) {
    if (a.slot === 'resurface' || !a.query) { searched.push({ angle: a, results: [] }); continue; }
    process.stdout.write(`검색: ${a.query.slice(0, 40)}… `);
    try {
      const j = await exaSearch(env.exa, a.query, NUM_RESULTS);
      exaCost += j.costDollars?.total ?? 0;
      const results = (j.results ?? []).map((r) => ({
        title: r.title, url: r.url, date: r.publishedDate?.slice(0, 10) ?? null,
        author: r.author, highlights: (r.highlights ?? []).join(' … ').slice(0, 900),
      }));
      console.log(`${results.length}개`);
      searched.push({ angle: a, results });
    } catch (e) {
      console.log(`실패(${e.message.slice(0, 40)})`);
      searched.push({ angle: a, results: [] });
    }
  }

  // 조립 입력 구성
  const payload = searched
    .map(({ angle, results }, i) => {
      const head = `## 각도 ${i + 1} [${angle.slot}] ${angle.query || '(되꺼냄)'}\nfrom: ${angle.from}\nwhy: ${angle.why}`;
      if (angle.slot === 'resurface') return `${head}\n(검색 없음 — 되꺼냄. 위 from의 파편을 지금 맥락에서 다시 본다.)`;
      const body = results.length
        ? results.map((r) => `- ${r.title ?? '(제목없음)'} | ${r.date ?? '날짜?'} | ${r.url}\n  ${r.highlights || '(발췌 없음)'}`).join('\n')
        : '(결과 없음)';
      return `${head}\n${body}`;
    })
    .join('\n\n');

  const user = [
    `<이미 저장>\n${saved.join(' / ')}\n</이미 저장>`,
    prior.urls.length ? `<이미 브리핑함>\n${prior.urls.join(' / ')}\n</이미 브리핑함>` : '',
    `<검색결과>\n${payload}\n</검색결과>`,
  ].filter(Boolean).join('\n\n');

  process.stdout.write('\n브리핑 조립 중 (gpt-5.5)…\n\n');
  const brief = await callOpenAI(env.openai, MODEL, ASSEMBLE_SYS, user);
  console.log('═'.repeat(70));
  console.log(brief);
  console.log('═'.repeat(70));
  console.log(`\nExa 비용 $${exaCost.toFixed(3)} (검색 ${searched.filter((s) => s.results.length).length}회)`);
  console.log('판단: 항목마다 O/X. 리스티클 걸러졌나? 이미 저장한 게 안 섞였나? 다른 갈래 있나?');
}

main().catch((e) => { console.error(e); process.exit(1); });
