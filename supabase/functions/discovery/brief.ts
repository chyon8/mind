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
import { anglesFromBlock, TOTAL_ANGLE_MAX } from './angles.ts';
import { ideaAngles } from './idea.ts';
import { dedupeAngles, logDedupe } from './dedupe.ts';
import { exaSearch } from './search.ts';

const NUM_RESULTS = 5;
const REPEAT_WINDOW_DAYS = 30; // 최근 이만큼의 브리핑 URL은 다시 안 꺼낸다
// 각도 프롬프트에 힌트로 넣을 "이미 다룬 주제" 개수 (최신순).
// ⚠️ 2026-07-26: 30으로 줄였다가 **되돌렸다.** 실측에서 잘린 중복 6개가 전부 힌트 밖(순번
//    31·33·38·57·66·134)이었다 — 모델이 못 본 주제를 그대로 다시 만들었고 각도 10개 중 6개가
//    날아갔다. **막는 게 잡는 것보다 6배 싸다**: 힌트는 입력($5/1M)이고 버려진 각도는 출력($30/1M)이다.
//    그리고 이건 파편 수와 무관하다 — 30일 창 × 브리핑당 8항목이 자연 상한이라 무한히 안 자란다.
//    아래 숫자는 폭주 방어선일 뿐이다(하루에 브리핑을 수십 번 눌렀을 때).
const PROMPT_TOPIC_HINT = 250;
// 조립 스트리밍 중 원장을 갱신하는 주기. 함수가 죽어도 여기까지는 남는다 (아래 조립부 주석).
const SAVE_EVERY_MS = 4000;

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
### [라벨] 제목 = 한 줄 발견. "이런 게 있다"가 아니라 "이게 너한테 뭐다"
**제목 맨 앞에 그 항목이 나온 각도의 slot을 대괄호 라벨로 붙인다.** 각도에 [expansion]이라
적혀 있으면 \`### [확장] …\`, [idea]면 \`### [아이디어] …\`, [resurface]면 \`### [되꺼냄] …\`.
주어진 slot을 그대로 옮긴다.
⚠️ **[아이디어]는 from의 「파편 → 동기」에서 동기 쪽만 이어진 각도다.** 파편의 소재로 되돌려
쓰지 마라 — 그 소재를 끊으려고 일부러 파편을 안 보고 만든 검색어다. 검색 결과에 나온
**바깥 사례가 주어**여야 한다. 제목이 \`NoPhone은 ~해야 한다\`처럼 이 사람의 프로젝트를 주어로
삼는 조언이 되면 그건 확장이니 \`[확장]\`으로 바꿔 써라.
제목 아래 **2~3문장으로 끝낸다.** 그 이상 쓰지 마라.
- 불릿으로 잘게 쪼개지 마라. 자연스럽게 이어지는 문장으로 쓴다.
- 뭔지 + 어느 파편에서 걸리는지 + 그래서 뭐가 흥미로운지를 한 흐름에 녹인다.
- 실물·구체는 문장 안에 자연스럽게 (누가 만들었나, 뭐가 다른가). 스펙 나열 금지.
- 추측이면 "내 추측인데" 한 번만.
- 문단 끝에 출처 **1개**: [짧은제목](url). 그 항목의 알맹이인 링크 하나만 고른다.
  두 번째 링크는 첫 번째와 **다른 걸 보여줄 때만** 붙인다(반박·원출처·다른 갈래).
  같은 종류의 제품 링크를 나란히 세 개 붙이는 건 출처가 아니라 목록이다 — 하지 마라.

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
// 제목 앞의 슬롯 라벨(`### [아이디어] …`). 반복 방지에 쓸 때는 떼어낸다 —
// 라벨은 모든 제목에 붙는 공통 접두사라 두면 중복 게이트의 유사도를 통째로 끌어올린다.
const SLOT_LABEL_RE = /^\[[^\]]{1,10}\]\s*/;

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
    .gte('created_at', since)
    // ⚠️ 정렬이 없었다. 아래에서 "최근 N개"를 자르는데 순서가 안 정해져 있으면
    //    임의의 N개가 된다 — 정작 어제 다룬 주제가 빠질 수 있다. 최신순으로 고정한다.
    .order('created_at', { ascending: false });
  const texts = (data ?? []).map((r) => (r.text as string) ?? '');
  return {
    topics: texts.flatMap((t) =>
      [...t.matchAll(HEADING_RE)].map((m) => m[1].trim().replace(SLOT_LABEL_RE, '')),
    ),
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
  // 프롬프트 힌트(약하지만 생성 자체를 막는다) + 게이트(확실하지만 이미 만든 걸 버린다) 이중 방어.
  // 힌트가 막아주면 각도 슬롯이 안 낭비되므로, 창 전체를 넣는 게 결과적으로 싸다 (위 상수 주석).
  const hintTopics = prior.topics.slice(0, PROMPT_TOPIC_HINT);
  const matBlock = materialBlock(material);
  const block =
    matBlock +
    (hintTopics.length ? `\n\n<이미 다룬 주제 (다시 꺼내지 마라)>\n${hintTopics.join(' / ')}` : '');
  // 확장·되꺼냄(angles.ts)과 아이디어(idea.ts)는 **서로를 안 기다린다** — 둘 다 같은 재료를
  // 읽을 뿐이다. 순차로 돌리면 실행 시간 한도에 가까워진다(잘림 사고의 원인이 그거였다).
  // ⚠️ 아이디어가 죽어도 브리핑은 확장으로 나가야 한다 → allSettled, 실패 시 빈 배열.
  const [expRes, ideaRes] = await Promise.allSettled([
    anglesFromBlock(
      block,
      DISCOVERY_MODEL,
      cost.track('discovery.angles', DISCOVERY_MODEL),
      cost.meta('discovery.angles'),
      material.picked.length, // 지정 하나당 각도 하나 — 코드에서 자른다 (angles.ts 참조)
    ),
    // ⚠️ 아이디어엔 **재료만** 준다 (`block`이 아니라 `matBlock`). <이미 다룬 주제>를 같이
    //    주면 ㉠ 입력이 1.8k → 10.3k로 불어 비용이 4배가 되고(실측 $0.03 → $0.12)
    //    ㉡ 모델이 그 목록을 **재료로 삼는다** — 루디 자기 문장에서 발견을 만든다
    //    (RUDY-DISCOVERY §7-f의 역류 버그). 반복 방지는 뒤의 중복 게이트가 한다.
    ideaAngles(matBlock, DISCOVERY_MODEL, cost),
  ]);
  if (expRes.status === 'rejected') throw expRes.reason; // 확장이 죽으면 브리핑 자체가 없다
  if (ideaRes.status === 'rejected') console.warn('[brief] 아이디어 경로 실패 → 확장만으로 진행', ideaRes.reason);

  const ideas = ideaRes.status === 'fulfilled' ? ideaRes.value : [];
  // 아이디어를 앞에 둔다 — 총량 상한에 걸려 잘릴 때 유저가 제일 원하는 것부터 남긴다.
  const raw = [...ideas, ...expRes.value].slice(0, TOTAL_ANGLE_MAX);
  console.log(`[brief] 각도 ${raw.length}개 (아이디어 ${ideas.length} + 확장·되꺼냄 ${expRes.value.length})`);
  if (!raw.length) {
    yield { t: 'done', empty: true }; // 볼 게 없으면 빈 브리핑 (§2-8)
    return;
  }

  // 게이트 둘 다 **검색 전에** 돈다 — 걸러진 각도의 Exa 비용은 아예 안 나가므로 품질과 비용이
  // 같은 방향이다. 그리고 둘 다 죽어도 브리핑은 살아야 한다(실패하면 원본 각도로 그냥 간다).
  let angles = raw;

  // 중복 게이트 — 지난 브리핑과 같은 주제를 다른 제목으로 꺼내는 걸 막는다.
  try {
    const r = await dedupeAngles(angles, prior.topics);
    logDedupe(supabase, r, angles.length);
    angles = r.kept;
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

  // ⚠️ **원장 행을 조립 *전에* 만든다** (2026-07-26 사고 수리).
  //    전에는 조립이 다 끝난 뒤에 insert했다. 그래서 함수가 조립 도중이나 직후에 죽으면
  //    화면에 다 나온 브리핑이 **기록에 한 줄도 안 남았다** — 실제로 07-26에 두 번 그랬고
  //    $0.65를 태우고 기록은 0건이었다. 채팅에서 이미 세운 원칙("화면에 나온 글자는 사라지지
  //    않는다")의 서버 쪽 짝이다. 죽는 원인이 무엇이든 마지막 갱신 시점까지는 남는다.
  const utt = () => supabase.schema('rudy').from('utterances');
  const { data: row } = await utt()
    .insert({ surface: 'briefing', kind: 'discovery', text: '', trigger: opts.trigger ?? 'pull' })
    .select('id')
    .single()
    .then((r) => r, (e) => {
      console.warn('[brief] 원장 행 생성 실패 — 끝나고 한 번 더 시도한다', e);
      return { data: null };
    });
  const rowId = (row as { id?: string } | null)?.id;

  let lastSave = Date.now();
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
    // 주기 저장. fire-and-forget이라 스트리밍을 안 막는다 — 지연은 안 늘고 유실 창만 줄어든다.
    // ⚠️ **비용도 같이 적는다.** text만 적었더니 중간에 죽은 브리핑이 화면에 "단가 미상"으로
    //    떴다 (cost_usd를 채우는 건 루프 *다음* 줄의 최종 update뿐이라 도달을 못 했다).
    //    이 시점 값에는 조립 비용이 아직 안 들어 있다 — OpenAI가 usage를 스트림 **마지막**
    //    청크로 주기 때문이다. 그래서 중간에 죽으면 각도 비용까지만 남는다(실제보다 적다).
    //    끝까지 가면 아래 최종 update가 정확한 값으로 덮는다. 잘린 브리핑에 잘린 비용이
    //    붙는 셈이라, "모른다"고 표시하는 것보다 이쪽이 사실에 가깝다.
    if (rowId && Date.now() - lastSave >= SAVE_EVERY_MS) {
      lastSave = Date.now();
      utt().update({ text: full, cost_usd: cost.result().usd }).eq('id', rowId)
        .then(undefined, (e: unknown) => console.warn('[brief] 중간 저장 실패', e));
    }
  }

  const { usd: costUsd } = cost.result();

  // 최종 기록 (§5·§6-4 ②) — 실패해도 브리핑은 살아야 한다. URL은 text에서 다시 뽑으므로 따로 안 넣는다.
  if (rowId) {
    // 한 글자도 못 쓰고 끝났으면 빈 행을 남기지 않는다 (기록 목록이 빈 줄로 더러워진다).
    const q = full.trim()
      ? utt().update({ text: full, cost_usd: costUsd }).eq('id', rowId)
      : utt().delete().eq('id', rowId);
    await q.then(undefined, (e: unknown) => console.warn('[brief] 원장 기록 실패', e));
  } else if (full.trim()) {
    await utt()
      .insert({
        surface: 'briefing',
        kind: 'discovery',
        text: full,
        trigger: opts.trigger ?? 'pull',
        cost_usd: costUsd,
      })
      .then(undefined, (e) => console.warn('[brief] 원장 기록 실패', e));
  }

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
