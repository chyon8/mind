// 발견 브리핑의 '각도 결정' 단계 (RUDY-DISCOVERY.md §2 · §7 판단 절반).
//
// ⚠️ 여기서는 검색하지 않는다. 이 사람의 저장소를 읽고 **무엇을 검색할지 각도만 정한다.**
//    발견 퀄리티가 코드가 아니라 이 판단에서 나온다 (§0). 검색 제공자(Exa 등)와 무관하다 —
//    뭘 붙이든 이 모듈은 그대로다. 그래서 제일 위험한 결정("어떤 모델이 판단하나")을
//    Exa에 한 푼 쓰기 전에 여기서 먼저 검증한다.
//
// ⚠️ ANGLE_SYS는 scripts/check-angles.mjs에 **복제되어 있다** (Deno↔node import 경계).
//    한쪽만 고치면 진단과 실물이 갈라진다 — check-clusters.mjs의 cluster()와 같은 약속이다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { complete, DISCOVERY_MODEL, type UsageSink } from '../_shared/openai.ts';
import { loadMaterial, materialBlock } from './material.ts';

export type Angle = {
  slot: 'expansion' | 'idea' | 'lens' | 'resurface';
  query: string; // 실제 검색창에 칠 구체적 문구
  from: string; // 어느 파편/프로젝트에서 나왔나
  why: string; // 왜 이 각도인가 (한 줄)
  from_picked: boolean; // 「내가 지정한 것」에서 나왔나 — 코드에서 개수를 자르는 근거
};

// 지정 컷이 각도를 이 개수 아래로 깎으면 컷을 포기한다.
// ⚠️ 안전망이 없으면 실사용에서 브리핑이 통째로 비었다 (2026-07-25): 모델이 플래그를 남발하면
//    각도가 전멸하고, 그러면 brief.ts가 early return해서 **원장 저장에도 도달하지 못한다.**
//    지정 하나가 브리핑을 먹는 것보다 브리핑이 사라지는 게 훨씬 나쁘다.
const MIN_ANGLES_AFTER_CUT = 6;

// 2026-07-26 유저 지시. lens는 코드로 자르고(상한), idea는 프롬프트로 요구한다(하한 — 코드는
// 각도를 만들 수 없다). 실측 근거: 프롬프트에 "lens 최대 1~2"를 써도 3개가 나왔다.
const LENS_MAX = 1;
const IDEA_MIN = 2;

export const ANGLE_SYS = `너는 Rudy의 발견 엔진에서 '각도 결정'을 맡는다.
아직 검색하지 않는다 — 이 사람의 저장소를 읽고 **무엇을 검색할지** 각도만 정한다.

이 사람은 스치는 생각·링크를 저장해두고 잊는다. 너는 그 저장소에서 출발해,
이 사람이 **아직 모르는 걸 바깥에서 물어올** 검색 각도를 만든다.

## 재료를 읽는 법 (성격이 다르다 — 절대 뭉뚱그리지 마라)
- **진행 중인 일 (프로젝트)**: 지금 만드는 일. 설명이 정답지다. 파편만 보고 넘겨짚지 마라.
- **아이디어·수집함**: 프로젝트가 아니라 **리스트**다 — 파편 하나하나가 내용 그 자체고,
  설명은 정답지가 아니라 라벨일 뿐이다. 💡는 "언젠가" 아이디어, 글감은 에세이 소재
  (프로덕트 아이디어처럼 다루지 마라).
- **미소속 파편**: 북마크·관찰. 저장한 링크가 여기 많다.

⚠️ **어느 구획이든, 실무 할일·수정사항 메모는 재료가 아니다.**
예: "메뉴 안 텍스트 수정", "버튼 색 바꾸기", "○○ 버그 확인", "우유 사기".
바깥에서 찾아올 게 없는 것들이다 — 각도로 만들지 마라. 특히 진행 중 프로젝트에는 이런
실무 메모가 섞여 있다. **재료는 관심·아이디어·참고자료·저장한 링크다.**

## 각도를 정하는 법 (제일 중요)
1. **저장한 북마크 × 프로젝트를 겹쳐라.** 저장한 링크가 프로젝트와 같은 물건이면,
   그건 참고자료가 아니라 경쟁자/선례다. "그게 실제로 되나, 누가 이미 하나"가 제일 강한 각도다.
2. **파편 두세 개가 한 방향을 가리키면 하나의 각도로 합쳐라.** 흩어진 걸 대신 이어준다.
3. **각도는 구체적이어야 한다.** "하드웨어"가 아니라 "STM32로 만드는 소형 신디사이저 프로젝트".
   막연하면 검색이 리스티클을 문다.
4. **한 파편에서 각도를 두 개 이상 만들지 마라.** 파편 하나가 브리핑을 먹으면 안 된다.

## slot — 각도의 성격 (출처가 아니라 하는 일이 다르다)
- **expansion**: 저장물이 가리키는 방향을 더 판다 — 경쟁자·선례·기술. **소재가 이어진다.**
- **idea**: **만들 만한 것을 물어온다. 소재는 끊고 동기를 잇는다.** 파편에서 "왜 저장했나"라는
  동기를 뽑아, 그 동기로 만들어진 **다른 소재**의 실물 제품·사례를 찾는다.
  from은 반드시 「파편 → 동기」 형식으로 쓴다. 동기를 지어내지 마라 — 파편에 근거해야 한다.
  **소재를 그대로 따라가면 그건 idea가 아니라 expansion이다.**
- **lens**: 다른 프레임으로 비춘다 — 관점·트렌드·전시·가서 볼 것. 프로덕트가 아니어도 된다.
- **resurface**: 오래돼 잊었을 파편 중 지금 상황과 새로 닿는 것. 검색이 아니라 되꺼냄이다.
  필요할 때만 — 닿는 게 없으면 안 넣는다.

## 이 사람의 렌즈 (취향)
- 소스 결: Hacker News / Indie Hackers / Product Hunt.
- 적당히 기술적. **너무 기술적이거나 학술적인 건 안 본다 — 논문·리서치 금지.**
- 확장은 "비슷한 프로덕트가 **실제로 있고 사람들이 쓴다**" — 개념 설명이 아니라 실물.
  수익이 보이면 좋지만 없어도 된다 (그런 숫자는 웹에 잘 없다 — 억지로 짜내지 마라).
- 다른 분야는 예술 자체가 아니라 **새로운 관점·트렌드·가서 볼 것**(전시·공간 등).
- **음악은 검색하지 마라.** 이 사람이 알아서 찾는다. 이 사람이 이미 잘 찾는 영역엔 들어가지 않는다.

## 구성 (제일 중요 — 프로젝트로 쏠리는 걸 막는다)
- **「내가 지정한 것」 구획이 주어지면, 거기 있는 파편 하나당 각도 **딱 1개**를 만든다.**
  \`"from_picked": true\`를 붙여라 (지정 구획에서 나온 각도만). **한 파편에서 두 개 이상 만들지 마라. 브리핑을 그 얘기로 채우지 마라.**
  지정이 1개면 그 각도도 1개고, 나머지 자리는 전부 아래 규칙대로 다른 재료에서 채운다.
- **「진행 중인 일」 구획에서 뽑는 각도는 최대 2개까지다. 0개여도 된다** —
  **2는 채워야 할 정원이 아니라 넘으면 안 되는 선이다.** 이번에 새로 걸리는 게 없으면
  안 다루는 게 맞다. 매번 같은 프로젝트(Caselab·Mind·No phone)가 나오면 이 사람은 발견을 꺼버린다.
  ⚠️ 이 캡은 「진행 중인 일」에만 걸린다. **「아이디어·수집함」과 미소속에는 안 걸린다.**
- **절반 이상을 「아이디어·수집함」 + 미소속 파편 + 완전히 새로운 갈래에서 뽑아라.**
  특히 **최근에 저장한 것(오늘·어제)을 우선 살펴라** — 지금 관심이 거기 있다.
- **<이미 다룬 주제>가 주어지면 그건 다시 꺼내지 마라.** 지난번에 다룬 걸 또 하면 반복이다.
  같은 주제를 다른 제목으로 꺼내는 것도 반복이다.
- **구성 (반드시 지켜라):**
  - **idea는 최소 2개.** 이게 이 사람이 제일 원하는 것이다. 1개면 실패다 —
    재료를 다시 훑어서 동기를 뽑아낼 파편을 더 찾아라. 저장물 대부분이 동기를 갖고 있다.
  - **lens는 최대 1개.** 관점·문학·전시는 좋지만 브리핑의 곁가지다. 2개 이상이면 잡지가 된다.
    (넘으면 코드가 잘라낸다 — 억지로 여러 개 만들어봐야 버려진다.)
  - 나머지는 expansion. resurface는 닿는 게 있을 때만 0~1개.
- **글감에서 뽑는 각도는 최대 1개.** 에세이 재료는 좋은 lens가 되지만, 소설·문학 각도가
  서너 개면 브리핑이 문예지가 된다.
- **10개 정도 만들어라.** 뒤에서 중복 각도를 걸러내므로 여유가 필요하다.
  단, 리스티클 미끼나 이미 아는 얘기로 자리를 메우진 마라 — 그건 걸러져도 자리만 낭비한다.

## 좋은 각도의 예 (실제로 이 사람에게 통한 것 — 사고방식을 그대로 배워라)
막연한 시장조사("AI 회의 어시스턴트 시장 분석")가 아니라, 저장소를 겹치고 합쳐서 나온 구체적 각도다:
- {"slot":"expansion","query":"Cluely 같은 실시간 회의 AI 어시스턴트 경쟁 제품과 수익 모델 indie hacker","from":"저장한 Cluely 북마크 × No phone(STT 미팅 어시스턴트)","why":"저장한 링크가 참고자료가 아니라 같은 물건 — 누가 이미 하고 돈 버나(원리 1)"}
- {"slot":"expansion","query":"STM32 라즈베리파이로 만드는 소형 사이버덱 DIY 조립 프로젝트","from":"'Crazy AI Cyberdeck' + 'epaper display' 파편 두 개","why":"흩어진 두 파편이 한 물건으로 합쳐진다 — PCB 없이 시작하는 진입점(원리 2)"}
- {"slot":"lens","query":"why cassette tapes and analog objects are back in 2026 friction as feature","from":"#cassette 파편 + Mind(일부러 흐려지는 앱)","why":"프로덕트가 아니라 관점 — 이 사람 제품의 근거를 새 프레임으로 비춘다(다른 갈래)"}
- {"slot":"idea","query":"micro SaaS built from one annoyance with existing tool solo founder revenue examples","from":"'리틀리 좀 더 커스터마이징… 결제 자유롭게' 파편 → 쓰던 도구의 불편 하나에서 출발해 1인이 만들어 파는 것","why":"소재(링크인바이오)를 끊고 동기로 뻗는다 — 같은 동기로 만들어진 다른 물건들이 재료다"}
- {"slot":"resurface","query":"","from":"'The Top Idea in Your Mind'(며칠 전 저장, 안 봄)","why":"저장한 날엔 에세이, 지금 3프로젝트+본업 상황에선 진단으로 읽힌다"}
위 예는 **형식과 사고방식**을 보여줄 뿐이다. 이 사람의 지금 재료로 새로 만들어라 — 예시를 복사하지 마라.

각 각도:
- slot: "expansion" | "idea" | "lens" | "resurface"
- query: 실제로 검색창에 칠 구체적 문구 (주제에 맞게 한국어 또는 영어)
- from: 어느 파편/프로젝트에서 나왔나. **idea는 「파편 → 동기」 형식으로.**
- why: 왜 이 각도인가, 한 줄
- from_picked: 「내가 지정한 것」구획의 파편에서 나온 각도면 true. **그 구획이 없으면 전부 false다.**
  ⚠️ "내가 이 각도를 골랐다"는 뜻이 **아니다.** 지정 구획에서 나온 것만 true다.

JSON만 출력: {"angles":[{"slot":"...","query":"...","from":"...","why":"...","from_picked":false}]}`;

// 2026-07-26: 'new' → 'lens' 개명 + 'idea' 신설. 'new'는 정의가 없어서 실질적으로 관점
// 슬롯으로 굳어 있었다(실측: "새로움" 각도 6개 전부 관점·문학). 이름이 하는 일을 말하게 바꾸고,
// 프로덕트 아이디어(동기 기반)는 제 슬롯을 받았다.
const SLOTS = ['expansion', 'idea', 'lens', 'resurface'];

// 재료 블록 → 각도. brief.ts가 재료를 한 번만 로드해 넘길 수 있게 블록을 받는다.
// resurface는 query가 비어 있어도 통과시킨다(검색이 아니라 되꺼냄이라서).
export function anglesFromBlock(
  block: string,
  model = DISCOVERY_MODEL,
  onUsage?: UsageSink,
  meta?: Record<string, string>,
  // 「내가 지정한 것」파편 수. 지정에서 나온 각도를 이 개수까지만 남긴다 (파편 하나당 각도 하나).
  pickedMax?: number,
): Promise<Angle[]> {
  return complete(
    [
      { role: 'system', content: ANGLE_SYS },
      { role: 'user', content: block },
    ],
    model,
    onUsage,
    meta,
  ).then((raw) => {
    const p = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
    const raws = Array.isArray(p?.angles) ? p.angles : [];
    let angles: Angle[] = raws
      .filter((a: unknown): a is Angle => {
        const x = a as Angle;
        return !!x && SLOTS.includes(x.slot) && typeof x.query === 'string';
      })
      .map((a: Angle) => ({ ...a, from_picked: a.from_picked === true }));

    // ⚠️ 지정에서 나온 각도는 **지정된 파편 수를 넘지 못한다.** 프롬프트만으로는 안 막힌다 —
    // §7-b의 교훈("약한 지시로는 구조적 쏠림을 못 이긴다, 숫자 캡이라야 이긴다")이 여기서도 그대로였다.
    // 실사용 버그(2026-07-25): 하나 지정했는데 브리핑 대부분이 그 얘기가 됐다. 원인은 프롬프트에
    // "어떤 캡·비율보다 이게 먼저다"라고 우선권을 준 것 — 슬롯을 줘야 하는 자리에 우선권을 줬다.
    //
    // ⚠️ 이 컷에는 방어가 둘 필요하다. 모델이 플래그를 남발하면(필드명을 "이 각도를 골랐다"로
    //    오해하면 전부 true가 된다) 각도가 전멸하고 브리핑이 통째로 사라진다 — 실제로 그랬다.
    //    ① 지정이 0개면 이 필드는 의미가 없으므로 **컷 자체를 돌리지 않는다.**
    //    ② 컷 결과가 너무 적으면 컷을 **포기한다** (지정 폭주는 조립 단계의 반복 방지가 또 막는다).
    if (pickedMax && pickedMax > 0) {
      let n = 0;
      const kept = angles.filter((a) => !a.from_picked || ++n <= pickedMax);
      if (kept.length >= MIN_ANGLES_AFTER_CUT) angles = kept;
      else console.warn('[angles] 지정 컷이 각도를 너무 깎아 포기', angles.length, '→', kept.length);
    }

    // lens 상한 (2026-07-26 유저 지시 "관점 한 개 넘지 않게").
    // ⚠️ 프롬프트에 "최대 1개"라고 써도 안 지켜졌다 — 실측에서 3개가 나왔고 그중 2개가 글감이었다.
    //    §7-b: "약한 지시로는 구조적 쏠림을 못 이긴다, 숫자 캡이라야 이긴다". 그래서 코드로 자른다.
    //    모델이 먼저 낸 것을 남긴다(제 딴엔 우선순위 순으로 냈을 테니).
    {
      let n = 0;
      const kept = angles.filter((a) => a.slot !== 'lens' || ++n <= LENS_MAX);
      if (kept.length >= MIN_ANGLES_AFTER_CUT) angles = kept;
      else console.warn('[angles] lens 컷이 각도를 너무 깎아 포기', angles.length, '→', kept.length);
    }

    // idea 하한은 **코드로 못 만든다** — 자를 순 있어도 생성할 순 없다. 프롬프트가 요구하고,
    // 미달이면 여기 남긴다. 몇 번 미달하는지가 프롬프트를 더 조일지 판단할 근거가 된다.
    const ideaCount = angles.filter((a) => a.slot === 'idea').length;
    if (ideaCount < IDEA_MIN) {
      console.warn(`[angles] idea 하한 미달: ${ideaCount}/${IDEA_MIN} — 프롬프트가 안 먹었다`);
    }
    // 상한. 중복 게이트(dedupe.ts)가 뒤에서 깎으므로 목표(8개)보다 넉넉히 통과시킨다.
    // ⚠️ **12로 올렸다가 10으로 되돌렸다 (2026-07-26).** 각도 1개 = Exa 검색 1번 + 조립 입력
    //    5건×900자다. 12개로 올린 날 함수가 시간 한도에 걸려 죽었고, 브리핑이 화면엔 나왔는데
    //    원장에 한 줄도 안 남았다. 10은 마지막으로 안정적으로 돌던 값이다. 여기를 올리려면
    //    먼저 실행 시간부터 재라 — 항목 수는 조립 프롬프트가 정하지 이 숫자가 정하는 게 아니다.
    return angles.slice(0, 10);
  });
}

export async function pickAngles(supabase: SupabaseClient, model = DISCOVERY_MODEL): Promise<Angle[]> {
  const material = await loadMaterial(supabase);
  return anglesFromBlock(materialBlock(material), model);
}
