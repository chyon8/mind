// 발견 브리핑의 '아이디어' 각도 — **2단계로 소재를 끊는다** (2026-07-27 신설).
//
// ⚠️ **왜 angles.ts가 아니라 따로인가.** idea의 정의는 "소재는 끊고 동기를 잇는다"인데,
//    파편을 보면서는 못 끊는다는 게 실측으로 확인됐다 (RUDY-DISCOVERY §7-f):
//    "소재를 따라가지 마라"고 해도, 심지어 금지어를 자기 입으로 선언시켜도 우회했다
//    (금지어 `사는 곳` 선언 → 검색어 `"creative residency" "community house"` — 단어만 피함).
//    **금지어는 단어를 막지 영역을 못 막는다.**
//
//    그래서 2단계 모델에게는 소재를 **아예 안 보여준다:**
//      1단계 — 재료를 읽고 파편에서 **동기만** 뽑는다 (물건 이름 없이 욕구·상태로)
//      2단계 — **파편을 안 준다. 동기 문장만 준다** → 검색어
//    2단계는 '키캡'이라는 단어를 본 적이 없어서 따라갈 수가 없다. 프롬프트 규칙이 아니라 구조다.
//
//    실측 (2회·10항목): 성공 6 · 애매 1 · 실패 3, 기계적 소재 누출 0건.
//    9회차 내내 예외 없이 코리빙으로만 가던 `유럽 여행` 파편이 처음으로 다른 데로 갔다
//    (`dark dining sensory restaurants`).
//
// ⚠️ **angles.ts의 `from`을 재활용하려다 실패했다 (실측).** ANGLE_SYS도 idea의 from을
//    「파편 → 동기」로 강제하지만, 그 동기엔 소재가 그대로 박혀 있다:
//      "'오랜만에 유럽 여행이나 가고싶다' → **여행**보다 **장소**와 사람을 강제로 바꾸는 장치"
//    3/3이 그랬다. 그래서 1단계를 따로 돌린다. 이 주석을 보고 다시 재활용하려 하지 마라.
//
// ⚠️ 프롬프트가 scripts/_discovery-lib.mjs에 **복제되어 있다** (Deno↔node 경계).
//    한쪽만 고치면 진단과 실물이 갈라진다.

import { complete, DISCOVERY_MODEL, type UsageSink } from '../_shared/openai.ts';
import type { Angle } from './angles.ts';

// brief.ts의 costTracker에서 필요한 부분만. 두 호출을 각각 다른 call_site로 남긴다.
type Cost = {
  track: (callSite: string, model: string) => UsageSink;
  meta: (callSite: string) => Record<string, string>;
};

const N_IDEA = 4;

// ── 1단계: 파편 → 동기. 여기서 소재가 새면 2단계가 무의미해진다. ──────────────
export const MOTIVE_SYS = `너는 이 사람의 저장물을 읽고 **왜 저장했는지(동기)만** 뽑는다.
아직 검색하지 않는다. 무엇을 찾을지도 정하지 않는다.

## 할 일
서로 다른 파편 ${N_IDEA}개를 고르고, 각각의 **동기**를 한 줄로 쓴다.
**진행 중인 프로젝트의 실무 메모는 고르지 마라** — 바깥에서 찾아올 게 없다.
글감·인용구·북마크·짧은 생각 전부 좋은 재료다.

## 동기를 쓰는 법 (제일 중요)
동기는 **욕구·상태**다. 물건이 아니다.
- ❌ "유럽에서 한 달 살아보고 싶다" — 장소가 들어 있다
- ❌ "키보드 키캡을 만들고 싶다" — 물건이 들어 있다
- ⭕ "익숙한 환경을 통째로 갈아엎어야 행동이 바뀐다고 믿는다"
- ⭕ "작은 물성을 손으로 만지고 남에게 자랑하고 싶다"

**동기 문장에 아래를 쓰지 마라:**
- 고유명사 (제품명·회사명·지명·언어명)
- 그 파편의 소재를 특정하는 명사 (키캡·책상·여행·앱·강의 같은 것)
- 업계 용어 (SaaS·대시보드·플랫폼)

동기만 읽었을 때 **원래 파편이 뭐였는지 못 알아맞혀야 제대로 쓴 것이다.**
그러면서도 사람의 욕구로서는 구체적이어야 한다 — "새로운 걸 원한다" 같은 건 너무 막연하다.

⚠️ **"해결 방법·행동 동사를 쓰지 마라"를 추가했다가 되돌렸다 (2026-07-27 실측).**
성공 개수는 그대로인데 **전시·공간 갈래가 3개→0개로 죽고** 회차 간 다양성이 줄었다.
감정만 남기면 감정에 제일 가까운 상품 카테고리가 앱이라 그쪽으로 빨려간다. 다시 넣지 마라.

## 출력
JSON만: {"items":[{"frag":"출발 파편 원문 일부","motive":"동기 한 줄"}]}
frag는 나중에 대조하려고 받는 것이다. 동기를 쓸 때 frag를 요약하지 마라 — 동기를 써라.`;

// ── 2단계: 동기만 보고 검색어. 파편은 절대 안 들어간다. ──────────────────────
export const IDEA_QUERY_SYS = `너는 이 사람이 구경할 만한 것을 찾을 검색어를 만든다.

## 이 사람의 취향
- 소스 결: Hacker News / Indie Hackers / Product Hunt.
- 적당히 기술적. **너무 기술적이거나 학술적인 건 안 본다 — 논문·리서치 금지.**
- "비슷한 프로덕트가 **실제로 있고 사람들이 쓴다**" — 개념 설명이 아니라 실물. 누가 만들었나.
- 다른 분야는 예술 자체가 아니라 **새로운 관점·트렌드·가서 볼 것**(전시·공간 등).
- **음악은 검색하지 마라.** 이 사람이 알아서 찾는다.

## 주어지는 것
이 사람이 무언가를 저장할 때의 **동기**다. 무엇을 저장했는지는 너에게 주지 않는다.
알 필요도 없다 — 같은 동기를 가진 **아무 소재나** 찾으면 된다.

## 할 일
동기 하나당 검색어 하나. 그 동기를 가진 사람이 좋아할 **실제로 존재하는 물건·제품·공간·씬**을
찾을 검색어를 만든다.

## 검색어의 모양
- **질문이 아니라 영역이다.** "○○을 어떻게 하나" 같은 질문형은 그 문제를 파는 업체 페이지만 부른다.
- **물건·장르·씬의 이름**으로 채운다. 동사("어떻게","왜","하는 법")를 넣지 마라.
- 추상명사만 나열하지 마라 — "tactile object communities" 같은 건 아무것도 안 물어온다.
  **실제로 그 물건을 파는 사람들이 쓸 단어**를 써라.
- 이미 아주 유명한 제품 이름은 넣지 마라. 그 회사 홈페이지만 나온다.

## 출력
JSON만: {"angles":[{"motive":"받은 동기 그대로","query":"검색어","area":"무슨 영역인지 한 줄"}]}`;

const parse = (raw: string) => JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());

/**
 * 재료 블록 → 아이디어 각도. 호출 2번(동기 추출 → 검색어).
 * 실패하면 **빈 배열을 돌려준다** — 아이디어가 없어도 브리핑은 확장으로 나가야 한다.
 */
export async function ideaAngles(
  block: string,
  model = DISCOVERY_MODEL,
  cost?: Cost,
): Promise<Angle[]> {
  // 1단계 — 재료 전체를 읽고 동기만
  const s1 = parse(await complete(
    [{ role: 'system', content: MOTIVE_SYS }, { role: 'user', content: block }],
    model,
    cost?.track('discovery.motive', model),
    cost?.meta('discovery.motive'),
  ));
  const items: { frag?: string; motive?: string }[] = Array.isArray(s1?.items) ? s1.items : [];
  const clean = items.filter((it) => typeof it.motive === 'string' && it.motive.trim()).slice(0, N_IDEA);
  if (!clean.length) {
    console.warn('[idea] 1단계가 동기를 못 냈다 — 아이디어 없이 진행');
    return [];
  }

  // 2단계 — **동기만** 넘긴다. frag는 여기 안 들어간다. 이게 이 모듈의 전부다.
  const motiveOnly = clean.map((it, i) => `${i + 1}. ${it.motive}`).join('\n');
  const s2 = parse(await complete(
    [{ role: 'system', content: IDEA_QUERY_SYS }, { role: 'user', content: `<동기>\n${motiveOnly}\n</동기>` }],
    model,
    cost?.track('discovery.idea', model),
    cost?.meta('discovery.idea'),
  ));
  const out: { query?: string; area?: string }[] = Array.isArray(s2?.angles) ? s2.angles : [];

  return out
    .map((a, i) => ({
      slot: 'idea' as const,
      query: (a.query ?? '').trim(),
      // from은 조립이 "어디서 출발했는지" 쓰는 데 필요하다. 「파편 → 동기」 형식을 유지한다.
      from: `${(clean[i]?.frag ?? '').slice(0, 80)} → ${clean[i]?.motive ?? ''}`,
      why: a.area ?? '',
      from_picked: false,
    }))
    .filter((a) => a.query);
}
