// 발견 각도 중복 게이트 (RUDY.md §6-4 ② · RUDY-DISCOVERY §7).
//
// ⚠️ **설계엔 있었고 구현이 없던 것이다.** 지금까지 반복 방지는 최근 브리핑의 `###` 제목을
//    **문자열**로 프롬프트에 넣어주는 게 전부였다. 그래서 유저가 계속 지적한 것이 안 막혔다:
//    "Cluely가 네 경쟁자다"를 피하라고 줘도 "콜센터 QA 자동화 스타트업"은 **다른 문자열**이라
//    통과한다. 같은 주제를 다른 제목으로 꺼내는 걸 문자열 비교로는 원리상 못 막는다.
//    (2026-07-25 유저: "저번에 브리핑에 나온 얘기가 또 나오고, 맨날 그놈의 Caselab 콜센터")
//
// → 각도를 임베딩해서 최근 브리핑 제목과 비교하고, 닮으면 **검색 전에** 버린다.
//   검색 전이라 걸러진 각도의 Exa 비용은 아예 안 나간다 — 품질과 비용이 같은 방향이다.
//
// 같은 실행 안의 중복도 같이 잡는다 — 하나를 여러 각도로 쪼갠 것(유저가 "하나 지정했는데
// 대부분이 그 내용"이라고 한 증상)은 조립 프롬프트에 부탁할 게 아니라 여기서 자를 일이다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { embedMany } from '../_shared/openai.ts';
import type { Angle } from './angles.ts';

// ⚠️ **잠정값이다.** §6-4의 0.85는 아이디어끼리 비교용이고, 여기는 한국어 제목 ↔ (영어가 섞인)
//    각도 문구라 점수가 더 낮게 깔린다. 이 코드베이스가 충돌 임계를 0.35→0.42로 뒤집었을 때와
//    같은 방식으로 **gate_log의 실측을 보고 조정한다** — 감으로 더 파지 않는다.
export const REPEAT_SIM = 0.6;

// 게이트가 각도를 이 아래로 깎으면 컷을 통째로 포기한다.
// ⚠️ 안전망 없는 게이트가 브리핑을 죽인 전례가 있다 (2026-07-25 from_picked 컷: 각도가 전멸해
//    brief.ts가 early return했고 원장 저장에도 도달하지 못했다). 중복보다 빈 브리핑이 훨씬 나쁘다.
const MIN_KEEP = 4;

// ⚠️ **창(30일) 전체를 덮는 게 목적이다.** 프롬프트 힌트는 최근 30개로 줄였고(brief.ts
//    PROMPT_TOPIC_HINT), 나머지 커버는 전부 여기가 맡는다. 임베딩은 제목 144개가 $0.0005라
//    사실상 공짜다 — 아낄 곳이 아니다. 이 숫자는 API 배열 상한(2048)에 대한 안전선일 뿐이다.
const MAX_PRIOR = 300;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// 각도를 한 덩어리 문장으로. query만 쓰면 영어 검색어라 한국어 제목과 안 닿는다 —
// from·why(한국어)를 같이 넣어야 "무엇에 관한 각도인가"가 벡터에 실린다.
const angleText = (a: Angle) => `${a.query} ${a.from} ${a.why}`.replace(/\s+/g, ' ').trim();

export type DedupeResult = {
  kept: Angle[];
  dropped: { query: string; sim: number; against: string }[];
  abandoned: boolean; // 안전망이 발동해 컷을 포기했나
};

/**
 * 최근 브리핑 주제 + 실행 내 중복을 걸러낸다. 임베딩 1회(≈$0.0002)로 끝난다.
 * 임베딩이 실패하면 **원본을 그대로 돌려준다** — 게이트 때문에 브리핑이 죽으면 본말전도다.
 */
export async function dedupeAngles(
  angles: Angle[],
  priorTopics: string[],
): Promise<DedupeResult> {
  // ⚠️ priorTopics는 **최신순**이다 (brief.ts가 created_at desc로 읽는다).
  //    slice(-N)으로 자르면 가장 오래된 N개를 집는다 — 정반대다.
  const prior = priorTopics.slice(0, MAX_PRIOR).filter((t) => t.trim());
  if (angles.length <= 1) return { kept: angles, dropped: [], abandoned: false };

  const texts = [...angles.map(angleText), ...prior];
  const vecs = await embedMany(texts);
  const angleVecs = vecs.slice(0, angles.length);
  const priorVecs = vecs.slice(angles.length);

  const kept: Angle[] = [];
  const keptVecs: number[][] = [];
  const dropped: DedupeResult['dropped'] = [];

  angles.forEach((a, i) => {
    const v = angleVecs[i];
    let best = 0;
    let against = '';
    // ① 지난 브리핑에서 이미 다룬 주제인가
    priorVecs.forEach((pv, j) => {
      const s = cosine(v, pv);
      if (s > best) {
        best = s;
        against = `이미 다룸: ${prior[j]}`;
      }
    });
    // ② 이번 실행에서 이미 채택한 각도와 겹치는가 (한 주제를 여러 각도로 쪼갠 것)
    keptVecs.forEach((kv, j) => {
      const s = cosine(v, kv);
      if (s > best) {
        best = s;
        against = `같은 실행: ${kept[j].query || kept[j].from}`;
      }
    });

    if (best >= REPEAT_SIM) {
      dropped.push({ query: a.query || a.from, sim: best, against });
      return;
    }
    kept.push(a);
    keptVecs.push(v);
  });

  // 안전망 — 너무 많이 잘렸으면 컷을 포기한다 (위 MIN_KEEP 주석 참고)
  if (kept.length < MIN_KEEP) {
    return { kept: angles, dropped, abandoned: true };
  }
  return { kept, dropped, abandoned: false };
}

// 판정을 원장에 남긴다 (§6-4). 이 로그가 REPEAT_SIM을 조정할 유일한 근거다 —
// 실패해도 삼킨다(fire-and-forget): 로그 때문에 브리핑이 죽으면 본말전도.
export function logDedupe(supabase: SupabaseClient, r: DedupeResult, angleCount: number) {
  // 살아남은 각도의 슬롯 구성. 유저 질문("아이디어가 제대로 나오고 있는 거 맞아?")에 답할
  // 유일한 근거다 — 전엔 idea 미달이 console.warn으로만 흘러서 지나가면 알 길이 없었다.
  const slots = r.kept.reduce<Record<string, number>>((acc, a) => {
    acc[a.slot] = (acc[a.slot] ?? 0) + 1;
    return acc;
  }, {});
  const mix = `확장${slots.expansion ?? 0} 아이디어${slots.idea ?? 0} 관점${slots.lens ?? 0} 되꺼냄${slots.resurface ?? 0}`;

  supabase
    .schema('rudy')
    .from('gate_log')
    .insert({
      surface: 'briefing',
      kind: 'discovery',
      gate: 'repetition',
      passed: r.dropped.length > 0 && !r.abandoned,
      reason: `${
        r.abandoned
          ? '너무 많이 잘려 컷 포기 — 빈 브리핑 방지'
          : r.dropped.length
            ? `중복 각도 ${r.dropped.length}개 제거`
            : '중복 없음'
      } · ${mix}`,
      detail: {
        threshold: REPEAT_SIM,
        angles: angleCount,
        kept: r.kept.length,
        slots,
        dropped: r.dropped,
      },
    })
    .then(undefined, (e: unknown) => console.warn('[dedupe] gate_log', e));
}
