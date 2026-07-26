// 발견 브리핑 조립 (RUDY-DISCOVERY §7 검색 절반 + §6 항목 모양).
//
// 재료 → 각도(gpt-5.5) → Exa 검색 → 조립(gpt-5.5). scripts/check-brief.mjs에서 실측 검증한
// 로직을 그대로 옮긴 것 — ASSEMBLE_SYS는 저 스크립트와 반드시 동일하게 유지한다.
//
// ⚠️ 반복 방지 (§6-4 ② · 유저가 명시적으로 걱정한 "똑같은 소리"): 최근 브리핑에서 인용한 URL을
//    원장에서 읽어 조립 프롬프트에 <이미 브리핑함>으로 넣는다. 새 코드로 게이트를 만들지 않고
//    모델에 "이건 이미 했다"를 알려주는 쪽 — 자발적 연결이 원장을 재사용한 것과 같은 결.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { chatStream, DISCOVERY_MODEL } from '../_shared/openai.ts';
import { costTracker } from '../_shared/usage.ts';
import { loadMaterial, materialBlock, type Frag } from './material.ts';
import { anglesFromBlock } from './angles.ts';
import { dedupeAngles, logDedupe } from './dedupe.ts';
import { exaSearch } from './search.ts';

const NUM_RESULTS = 5;
const REPEAT_WINDOW_DAYS = 30; // 최근 이만큼의 브리핑 URL은 다시 안 꺼낸다

// ⚠️ scripts/check-brief.mjs의 ASSEMBLE_SYS와 반드시 동일.
const ASSEMBLE_SYS = `너는 Rudy다. 이 사람을 위해 바깥에서 찾아온 것들을 아침 브리핑으로 쓴다.
각 항목은 [각도]와 [그 각도로 검색한 결과들(highlights=본문 발췌)]로 주어진다.
**highlights를 실제로 읽고** 판단한다 — 제목만 보고 쓰지 마라.

## 거르는 법 (제일 중요 — 통과보다 거절이 신뢰를 만든다)
- **리스티클/SEO 쓰레기는 버린다.** "N Best…", "Top 10…", 어필리에이트 비교글. highlights에 알맹이(실물·1차 경험)가 없으면 버린다.
- **이 사람이 이미 저장했거나 이미 브리핑한 것과 겹치면 뺀다.** <이미 저장>·<이미 브리핑함>에 있는 걸 "발견"이라 하지 마라.
- **각도 하나 = 항목 하나가 기본이다. 목표는 8개.** 각도가 8개 왔으면 항목도 8개 쓴다.
  8개보다 많이 오면 제일 좋은 8개를 고르고, 8개 이하면 온 만큼 다 쓴다.
  버리는 건 **예외**다 — 그 각도의 검색 결과가 전부 리스티클이거나 알맹이가 아예 없을 때만.
  애매한 걸 "완벽하지 않아서" 깎지 마라. **2개 이상 버리게 되면 네 기준이 너무 빡빡한 것이니
  다시 봐라.** 이 사람이 "개수가 부족하다"고 명시적으로 말했다.
- **한 주제로 브리핑을 채우지 마라.** 같은 파편·같은 프로젝트에서 나온 항목이 3개 이상이면
  제일 좋은 것만 남기고 나머지는 버린다. 하나를 여러 각도로 쪼갠 건 발견이 아니라 반복이다.

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
- 항목 사이는 빈 줄 하나.
- **짧게 쓰는 건 항목 하나하나에서 한다 (2~3문장). 항목 수를 줄여서 하지 마라.**
  전체 길이를 맞추려고 항목을 빼는 건 금지다 — 8개를 짧게 쓰는 게 5개를 길게 쓰는 것보다 낫다.
- 맨 위에 인삿말·서론 쓰지 마라. 바로 첫 항목(### )부터.
- 버리거나 못 찾은 게 있으면 **맨 끝에 ※ 로 시작하는 한 줄**로 짧게(§2-b). 예: \`※ 더현대 팝업은 리스티클이라 뺐다.\`
  이 줄은 카드가 아니라 각주다 — 반드시 ※ 로 시작하고, 항목(###) 본문에 섞지 마라. 없으면 생략.

마크다운으로 쓴다. 항목 제목은 ### 로.`;

const URL_RE = /\((https?:\/\/[^)]+)\)/g;
const HEADING_RE = /^###\s+(.+)$/gm;

// 최근 브리핑에서 다룬 주제(### 제목)와 인용 URL — 반복 방지용 (§6-4 ②).
// ⚠️ URL만 막으면 같은 프로젝트가 매번 다른 링크로 또 나온다(유저가 지적). **주제**를 넘겨
//    각도 단계에서 "이미 다룬 것"을 피하게 한다. utterances에 detail 컬럼이 없어 text에서 뽑는다.
async function recentBriefContext(
  supabase: SupabaseClient,
): Promise<{ topics: string[]; urls: string[] }> {
  const since = new Date(Date.now() - REPEAT_WINDOW_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .schema('rudy')
    .from('utterances')
    .select('text')
    .eq('kind', 'discovery')
    .eq('surface', 'briefing')
    .gte('created_at', since);
  const texts = (data ?? []).map((r) => (r.text as string) ?? '');
  return {
    topics: texts.flatMap((t) => [...t.matchAll(HEADING_RE)].map((m) => m[1].trim())),
    urls: texts.flatMap((t) => [...t.matchAll(URL_RE)].map((m) => m[1])),
  };
}

// 스트리밍 이벤트 — 앱이 단계별 로딩 + 카드가 차오르는 걸 그릴 수 있게 (NDJSON 한 줄씩).
export type BriefEvent =
  | { t: 'status'; stage: 'reading' | 'angles' | 'search' | 'writing'; count?: number }
  | { t: 'd'; c: string } // 조립 토큰
  | { t: 'done'; empty: boolean; costUsd?: number | null };

export type BriefOptions = {
  // 'push' = 아침 푸시가 만든 것, 'pull' = 유저가 화면에서 직접 만든 것 (기본).
  // 원장에 남겨서 목록 화면이 "아침 브리핑"으로 구분 표시한다(유저 요청) — 새 표면 없이 태그만.
  trigger?: 'pull' | 'push';
  // 아침 버전은 관찰 한 줄(§4-F5 거울 정신)을 카드 앞에 붙인다. 여기서 문자열로 받아 조립 앞에 얹는다.
  prelude?: string;
};

// 재료 → 각도 → 검색 → 조립(스트리밍). 각 단계 앞에서 status를 흘려 앱이 "지금 뭐 하는 중"을 보여준다.
// 30~60초를 못 줄이는 대신, 진행이 보이면 체감이 확 낫다 (유저: "너무 오래 걸려").
export async function* streamBrief(
  supabase: SupabaseClient,
  opts: BriefOptions = {},
): AsyncGenerator<BriefEvent> {
  // 비용 추적 (2026-07-22) — 브리핑 하나가 gpt-5.5를 2번(각도·조립) 태운다. request_id로 묶는다.
  const cost = costTracker(supabase, { requestId: crypto.randomUUID() });

  yield { t: 'status', stage: 'reading' };
  const [material, prior] = await Promise.all([loadMaterial(supabase), recentBriefContext(supabase)]);

  yield { t: 'status', stage: 'angles' };
  const block =
    materialBlock(material) +
    (prior.topics.length ? `\n\n<이미 다룬 주제 (다시 꺼내지 마라)>\n${prior.topics.join(' / ')}` : '');
  const raw = await anglesFromBlock(
    block,
    DISCOVERY_MODEL,
    cost.track('discovery.angles', DISCOVERY_MODEL),
    cost.meta('discovery.angles'),
    material.picked.length, // 지정 하나당 각도 하나 — 코드에서 자른다 (angles.ts 참조)
  );
  if (!raw.length) {
    yield { t: 'done', empty: true }; // 볼 게 없으면 빈 브리핑 (§2-8)
    return;
  }

  // 중복 게이트 (dedupe.ts) — **검색 전에** 자른다. 지난 브리핑과 같은 주제를 다른 제목으로
  // 꺼내는 걸 여기서 막는다. 걸러진 각도의 Exa 비용은 아예 안 나가므로 품질과 비용이 같은 방향.
  // 게이트가 죽어도 브리핑은 살아야 한다 — 실패하면 원본 각도로 그냥 간다.
  let angles = raw;
  try {
    const r = await dedupeAngles(raw, prior.topics);
    angles = r.kept;
    logDedupe(supabase, r, raw.length);
  } catch (e) {
    console.warn('[brief] 중복 게이트 실패 → 거르지 않고 진행', e);
  }

  const toSearch = angles.filter((a) => a.slot !== 'resurface' && a.query);
  yield { t: 'status', stage: 'search', count: toSearch.length };
  const searched = await Promise.all(
    angles.map(async (a) => {
      if (a.slot === 'resurface' || !a.query) return { angle: a, results: [] as SearchLine[] };
      try {
        const results = await exaSearch(a.query, NUM_RESULTS);
        return {
          angle: a,
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            date: r.publishedDate?.slice(0, 10) ?? null,
            highlights: r.highlights.join(' … ').slice(0, 900),
          })),
        };
      } catch (e) {
        console.warn('[brief] 검색 실패', a.query, e);
        return { angle: a, results: [] as SearchLine[] };
      }
    }),
  );

  const payload = searched
    .map(({ angle, results }, i) => {
      const head = `## 각도 ${i + 1} [${angle.slot}] ${angle.query || '(되꺼냄)'}\nfrom: ${angle.from}\nwhy: ${angle.why}`;
      if (angle.slot === 'resurface') return `${head}\n(검색 없음 — 되꺼냄. 위 from의 파편을 지금 맥락에서 다시 본다.)`;
      const body = results.length
        ? results
            .map((r) => `- ${r.title ?? '(제목없음)'} | ${r.date ?? '날짜?'} | ${r.url}\n  ${r.highlights || '(발췌 없음)'}`)
            .join('\n')
        : '(결과 없음)';
      return `${head}\n${body}`;
    })
    .join('\n\n');

  const user = [
    // ⚠️ projects·lists·loose **전부** 넣는다. 구획을 나눈 뒤 lists를 빠뜨리면 💡에 저장해둔
    //    링크를 "발견"이라고 다시 물어온다.
    `<이미 저장>\n${material.loose
      .concat(material.projects.flatMap((p) => p.fragments))
      .concat(material.lists.flatMap((p) => p.fragments))
      .map(savedTitle)
      .join(' / ')}\n</이미 저장>`,
    prior.urls.length ? `<이미 브리핑함>\n${prior.urls.join(' / ')}\n</이미 브리핑함>` : '',
    `<검색결과>\n${payload}\n</검색결과>`,
  ]
    .filter(Boolean)
    .join('\n\n');

  yield { t: 'status', stage: 'writing' };
  // 관찰 한 줄이 있으면 카드 앞에 먼저 흘린다 — parseCards가 헤딩 이전 줄을 각주(제목 없음)로
  // 렌더하므로 클라 변경 없이 "관찰"이 조용히 얹힌다.
  let full = opts.prelude ? `${opts.prelude}\n\n` : '';
  if (opts.prelude) yield { t: 'd', c: full };
  for await (const delta of chatStream(
    [
      { role: 'system', content: ASSEMBLE_SYS },
      { role: 'user', content: user },
    ],
    DISCOVERY_MODEL,
    cost.track('discovery.assemble', DISCOVERY_MODEL),
    cost.meta('discovery.assemble'),
  )) {
    full += delta;
    yield { t: 'd', c: delta };
  }

  const { usd: costUsd } = cost.result();

  // 원장 기록 (§5·§6-4 ②) — 실패해도 브리핑은 살아야 한다. URL은 text에서 다시 뽑으므로 따로 안 넣는다.
  await supabase
    .schema('rudy')
    .from('utterances')
    .insert({
      surface: 'briefing',
      kind: 'discovery',
      text: full,
      trigger: opts.trigger ?? 'pull',
      cost_usd: costUsd,
    })
    .then(undefined, (e) => console.warn('[brief] 원장 기록 실패', e));

  // 유저 지정을 소비한다 (RUDY-STATUS.md ①) — 한 번 나오고 끝. 안 내리면 매 브리핑에 또 나와서
  // 그게 §6-4 ②가 막으려는 반복이 된다.
  // ⚠️ **전부 내린다.** 어느 지정이 실제로 각도가 됐는지는 알 수 없다 — 각도 출력의 `from`은
  //    자유 문장이고 파편 id가 없다. 또 원하면 또 누르는 게 유저가 승인한 동작이다.
  // ⚠️ 이건 touch가 아니다 — last_touched_at·touch_count를 안 건드리므로 §2-3은 지켜진다.
  if (material.picked.length) {
    await supabase
      .from('fragments')
      .update({ discover_next: false })
      .eq('discover_next', true)
      .then(undefined, (e) => console.warn('[brief] 지정 해제 실패', e));
  }

  yield { t: 'done', empty: !full.trim(), costUsd };
}

type SearchLine = { title: string | null; url: string; date: string | null; highlights: string };

const savedTitle = (f: Frag) =>
  ((f.type === 'link' ? f.link_title ?? f.content : f.content) ?? '').replace(/\s+/g, ' ').slice(0, 70);
