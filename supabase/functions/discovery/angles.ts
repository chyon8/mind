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
  slot: 'expansion' | 'new' | 'resurface';
  query: string; // 실제 검색창에 칠 구체적 문구
  from: string; // 어느 파편/프로젝트에서 나왔나
  why: string; // 왜 이 각도인가 (한 줄)
};

export const ANGLE_SYS = `너는 Rudy의 발견 엔진에서 '각도 결정'을 맡는다.
아직 검색하지 않는다 — 이 사람의 저장소를 읽고 **무엇을 검색할지** 각도만 정한다.

이 사람은 스치는 생각·링크를 저장해두고 잊는다. 너는 그 저장소에서 출발해,
이 사람이 **아직 모르는 걸 바깥에서 물어올** 검색 각도를 만든다.

## 재료를 읽는 법 (성격이 다르다 — 절대 뭉뚱그리지 마라)
- 진행 중 프로젝트(active): 지금 만드는 일. 설명이 정답지다. 파편만 보고 프로젝트를 넘겨짚지 마라.
- 💡 등 미착수: 아직 안 정한 아이디어 수집. "언젠가" 리스트일 수 있다.
- 글감: 에세이 소재. 프로덕트가 아니다. 프로덕트 아이디어처럼 다루지 마라.
- 미소속 파편: 북마크·관찰. 저장한 링크가 여기 많다.

## 각도를 정하는 법 (제일 중요)
1. **저장한 북마크 × 프로젝트를 겹쳐라.** 저장한 링크가 프로젝트와 같은 물건이면,
   그건 참고자료가 아니라 경쟁자/선례다. "그게 실제로 되나, 누가 이미 하나"가 제일 강한 각도다.
2. **파편 두세 개가 한 방향을 가리키면 하나의 각도로 합쳐라.** 흩어진 걸 대신 이어준다.
3. **각도는 구체적이어야 한다.** "하드웨어"가 아니라 "STM32로 만드는 소형 신디사이저 프로젝트".
   막연하면 검색이 리스티클을 문다.
4. **resurface**: 오래돼 잊었을 파편 중, 지금 상황과 새로 닿는 것 하나. 검색이 아니라 되꺼냄이다.

## 이 사람의 렌즈 (취향)
- 소스 결: Hacker News / Indie Hackers / Product Hunt.
- 적당히 기술적. **너무 기술적이거나 학술적인 건 안 본다 — 논문·리서치 금지.**
- 확장은 "비슷한 프로덕트가 **실제로 있고 사람들이 쓴다**" — 개념 설명이 아니라 실물.
  수익이 보이면 좋지만 없어도 된다 (그런 숫자는 웹에 잘 없다 — 억지로 짜내지 마라).
- 다른 분야는 예술 자체가 아니라 **새로운 관점·트렌드·가서 볼 것**(전시·공간 등).
- **음악은 검색하지 마라.** 이 사람이 알아서 찾는다. 이 사람이 이미 잘 찾는 영역엔 들어가지 않는다.

## 구성 (제일 중요 — 프로젝트로 쏠리는 걸 막는다)
- **진행 중 프로젝트 확장은 최대 2개.** 프로젝트가 셋이라고 셋 다 꺼내지 마라 —
  매번 같은 프로젝트(Caselab·Mind·No phone)가 나오면 이 사람은 발견을 꺼버린다.
- **절반 이상을 미소속 파편(북마크·관찰) + 완전히 새로운 갈래에서 뽑아라.**
  특히 **최근에 저장한 것(오늘·어제)을 우선 살펴라** — 지금 관심이 거기 있다. 미소속에 좋은 재료가 많다.
- **<이미 다룬 주제>가 주어지면 그건 다시 꺼내지 마라.** 지난번에 다룬 걸 또 하면 반복이다.
- new(완전히 새로운 것)·다른 분야(관점·전시·트렌드)를 반드시 섞어라.
- **6~8개는 상한이지 목표가 아니다.** 좋은 각도가 4개면 4개만. 억지로 채우면 그 순간 쓰레기가 섞인다.

## 좋은 각도의 예 (실제로 이 사람에게 통한 것 — 사고방식을 그대로 배워라)
막연한 시장조사("AI 회의 어시스턴트 시장 분석")가 아니라, 저장소를 겹치고 합쳐서 나온 구체적 각도다:
- {"slot":"expansion","query":"Cluely 같은 실시간 회의 AI 어시스턴트 경쟁 제품과 수익 모델 indie hacker","from":"저장한 Cluely 북마크 × No phone(STT 미팅 어시스턴트)","why":"저장한 링크가 참고자료가 아니라 같은 물건 — 누가 이미 하고 돈 버나(원리 1)"}
- {"slot":"expansion","query":"STM32 라즈베리파이로 만드는 소형 사이버덱 DIY 조립 프로젝트","from":"'Crazy AI Cyberdeck' + 'epaper display' 파편 두 개","why":"흩어진 두 파편이 한 물건으로 합쳐진다 — PCB 없이 시작하는 진입점(원리 2)"}
- {"slot":"new","query":"why cassette tapes and analog objects are back in 2026 friction as feature","from":"#cassette 파편 + Mind(일부러 흐려지는 앱)","why":"프로덕트가 아니라 관점 — 이 사람 제품의 근거를 새 프레임으로 비춘다(다른 갈래)"}
- {"slot":"resurface","query":"","from":"'The Top Idea in Your Mind'(며칠 전 저장, 안 봄)","why":"저장한 날엔 에세이, 지금 3프로젝트+본업 상황에선 진단으로 읽힌다"}
위 예는 **형식과 사고방식**을 보여줄 뿐이다. 이 사람의 지금 재료로 새로 만들어라 — 예시를 복사하지 마라.

각 각도:
- slot: "expansion" | "new" | "resurface"
- query: 실제로 검색창에 칠 구체적 문구 (주제에 맞게 한국어 또는 영어)
- from: 어느 파편/프로젝트에서 나왔나 (완전히 새로운 것이면 "")
- why: 왜 이 각도인가, 한 줄

JSON만 출력: {"angles":[{"slot":"...","query":"...","from":"...","why":"..."}]}`;

const SLOTS = ['expansion', 'new', 'resurface'];

// 재료 블록 → 각도. brief.ts가 재료를 한 번만 로드해 넘길 수 있게 블록을 받는다.
// resurface는 query가 비어 있어도 통과시킨다(검색이 아니라 되꺼냄이라서).
export function anglesFromBlock(
  block: string,
  model = DISCOVERY_MODEL,
  onUsage?: UsageSink,
  meta?: Record<string, string>,
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
    const angles = Array.isArray(p?.angles) ? p.angles : [];
    return angles
      .filter((a: unknown): a is Angle => {
        const x = a as Angle;
        return !!x && SLOTS.includes(x.slot) && typeof x.query === 'string';
      })
      .slice(0, 8); // 상한 (§2-8)
  });
}

export async function pickAngles(supabase: SupabaseClient, model = DISCOVERY_MODEL): Promise<Angle[]> {
  const material = await loadMaterial(supabase);
  return anglesFromBlock(materialBlock(material), model);
}
