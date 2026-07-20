// 클러스터 엔진 — B1·B2의 심장 (RUDY.md §6-2 · §10-6).
//
// ⚠️ 여기서 나온 것은 **아무데도 저장되지 않는다** (§2-1 규정 금지).
//    실행 시점에 묶고, 답에 쓰고, 버린다. `rudy.clusters` 같은 테이블을 만드는 순간
//    "이 사람은 이런 사람"을 DB에 적는 것이고, 그게 이 시스템이 안 하기로 한 유일한 일이다.
//
// ⚠️ cluster()는 scripts/check-clusters.mjs와 **같은 로직**이어야 한다 (embedText 선례).
//    임계값은 저 스크립트로 실측해서 정했다 — 로직이 갈라지면 그 숫자가 무의미해진다.

import { kstDate } from './time.ts';

export type Edge = { a: string; b: string; similarity: number };

/**
 * 평균연결(average linkage) 병합.
 *
 * 단일연결(=연결요소)을 안 쓰는 이유: A–B, B–C 두 엣지만 있어도 A·C가 한 덩어리가 된다(체이닝).
 * 무관한 두 주제가 어중간한 파편 하나를 다리 삼아 붙으면 그건 축이 아니라 죽이고,
 * 거기 이름을 붙이라고 하면 LLM은 반드시 그럴듯한 거짓말을 만들어낸다(§2-8 억지 연결).
 * 평균연결은 두 덩어리 사이 **모든 쌍**의 평균을 보므로 다리 하나로는 안 붙는다.
 *
 * 임계 미만 쌍은 유사도 0으로 친다 — 그 쌍들이 평균을 끌어내리는 게 정확히 원하는 동작이다.
 */
export function cluster(edges: Edge[], minAvg: number, minSize = 3): string[][] {
  // 노드 = 엣지에 등장한 것만. 아무와도 안 닿은 파편은 애초에 축이 될 수 없다.
  const nodes = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const groups = new Map<number, string[]>(nodes.map((n, i) => [i, [n]]));

  const key = (i: number, j: number) => (i < j ? `${i}|${j}` : `${j}|${i}`);
  const sum = new Map<string, number>(); // 덩어리 쌍 사이 유사도 합
  for (const e of edges) {
    const k = key(idx.get(e.a)!, idx.get(e.b)!);
    sum.set(k, (sum.get(k) ?? 0) + e.similarity);
  }

  for (;;) {
    let bestK: string | null = null;
    let bestAvg = minAvg; // 임계 미만이면 더 안 붙인다
    for (const [k, s] of sum) {
      const [i, j] = k.split('|').map(Number);
      const avg = s / (groups.get(i)!.length * groups.get(j)!.length);
      if (avg >= bestAvg) { bestAvg = avg; bestK = k; }
    }
    if (!bestK) break;

    const [i, j] = bestK.split('|').map(Number);
    groups.set(i, [...groups.get(i)!, ...groups.get(j)!]);
    groups.delete(j);
    for (const [k, s] of [...sum]) {
      const [x, y] = k.split('|').map(Number);
      if (x !== j && y !== j) continue;
      sum.delete(k);
      const other = x === j ? y : x;
      if (other === i) continue;
      const nk = key(i, other);
      sum.set(nk, (sum.get(nk) ?? 0) + s); // 흡수한 쪽의 합을 물려받는다
    }
  }

  // §4-B1: 근거 파편 ≥3개. 2개짜리는 축이 아니라 그냥 닮은 둘이다.
  return [...groups.values()].filter((g) => g.length >= minSize);
}

// vividness.ts와 같은 감쇠 법칙. 앱의 원천은 vividness.ts다 —
// 여기선 순위 가중에만 쓴다(§6-2: 흐려진 증거는 약하게 반영). 선명도를 저장하지는 않는다.
export function vividness(
  fr: { last_touched_at: string; tier: string; touch_count: number },
  now = new Date(),
): number {
  if (fr.tier === 'pinned') return 1;
  const tier = fr.tier === 'normal' && fr.touch_count >= 2 ? 'important' : fr.tier;
  const [start, floor] = tier === 'important' ? [14, 45] : [3, 14];
  const days = Math.max(0, (now.getTime() - new Date(fr.last_touched_at).getTime()) / 86_400_000);
  if (days <= start) return 1;
  if (days >= floor) return 0.25;
  return 1 - 0.75 * ((days - start) / (floor - start));
}

export type Shape = {
  kind: '지속' | '중간' | '단발';
  spanDays: number;
  quietDays: number;
  activeDays: number;
};

/**
 * §4-B2 지속성 척도 = 증거 타임스탬프 분포. **계산이지 LLM의 일이 아니다** —
 * 여기를 모델에 맡기면 "요즘 꽂혀 있네" 같은 말을 근거 없이 하게 된다.
 *
 * 지속 = 3주 이상에 걸쳐 분포 / 단발 = 7일 이내 버스트.
 * quietDays(마지막 증거 이후)가 있어야 "그 축, 3주째 조용해"를 말할 수 있다 —
 * 없는 것을 말하는 건 검색이 원리상 못 하는 일이고, 클러스터의 존재 이유 중 하나다.
 *
 * ⚠️ span(양끝 거리)만으로 지속을 판정하면 안 된다. 3개를 하루에 몰아 저장하고 한 달 뒤
 * 1개를 더 저장하면 span은 31일이지만 그건 "3주간 반복된 관심"이 아니라 **두 번 있었던 일**이다.
 * §4-B1이 보려는 건 흩어짐이지 양끝 거리가 아니다 → **서로 다른 저장일 3일 이상**을 함께 요구한다.
 */
export function shape(dates: string[], now = new Date()): Shape {
  const t = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const spanDays = (t[t.length - 1] - t[0]) / 86_400_000;
  const quietDays = (now.getTime() - t[t.length - 1]) / 86_400_000;
  // 날짜 경계는 KST — UTC로 세면 KST 새벽 저장분이 별개의 "저장일"로 잡혀 지속 판정이 부풀려진다
  const activeDays = new Set(dates.map(kstDate)).size;
  return {
    kind: spanDays >= 21 && activeDays >= 3 ? '지속' : spanDays <= 7 ? '단발' : '중간',
    spanDays,
    quietDays,
    activeDays,
  };
}
