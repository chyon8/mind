// 클러스터 → 채팅에 넘길 <축> 블록 (RUDY.md §4-B1·B2 · §10-6).
//
// 이게 RAG 나열과 다른 지점, 세 가지:
//   1. 질문이 입력이 아니다 — 질문에 가까운 걸 뽑는 게 아니라 서로 가까운 것끼리 묶는다.
//   2. 묶고 이름 붙인다 — 파편 14개가 축 1개가 된다. 나열이 아니라 축소.
//   3. 시간 모양을 안다 — "그 축, 3주째 조용해"를 말할 수 있다. 검색은 없는 것을 영원히 못 말한다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { complete, FAST_MODEL, type UsageSink } from '../_shared/openai.ts';
import { cluster, shape, vividness, type Edge, type Shape } from '../_shared/cluster.ts';
import { kstDate } from '../_shared/time.ts';

// 실측으로 정했다 (scripts/check-clusters.mjs, 2026-07-20). 0.46이면 축이 2개로 줄고
// 커버리지가 절반이 된다. **잠정값이다** — 충돌 임계를 0.35→0.42로 올린 것과 같은 재조정을
// 각오할 것. 코퍼스가 5일치일 때 정한 숫자다. 판정마다 gate_log에 실측을 남긴다.
export const MIN_SIM = 0.42;
const WINDOW_DAYS = 90; // §6-2: 최근 90일 items
const MAX_AXES = 5; // 다 보여주는 사서는 사서가 아니다

type Frag = {
  id: string;
  created_at: string;
  type: string;
  content: string;
  link_title: string | null;
  last_touched_at: string;
  tier: string;
  touch_count: number;
};

const FRAG_COLS =
  'id, created_at, type, content, link_title, last_touched_at, tier, touch_count';

// stated: 이 축의 파편들에 대해 **유저가 직접 말한 것** (§4-F1이 받아낸 자기 진술).
// 이게 있으면 루디는 추측 화법을 벗을 수 있다 — §4-B2가 요구한 바로 그 경계선이다.
export type Axis = { label: string; items: Frag[]; weight: number; stated: string[] } & Shape;

const title = (f: Frag) =>
  ((f.type === 'link' ? f.link_title ?? f.content : f.content) ?? '').replace(/\s+/g, ' ').slice(0, 60);

// 라벨은 LLM이 그때그때 붙인다 (§6-2). **미리 정한 카테고리 집합에 분류하지 않는다** —
// 분류표를 두는 순간 그게 저장된 유저 프로필이 되고 §2-1을 어긴다.
const LABEL_SYS = `각 묶음은 한 사람의 메모 저장소에서 의미가 가까워 뭉친 파편들이다.
묶음마다 그 묶음이 무엇에 관한 것인지 짧은 이름을 붙여라.

- 2~6글자 명사구. 예: "하드웨어 신디사이저", "독서", "앱 UI"
- 실제로 그 목록에 있는 것만 이름에 반영한다. 없는 주제를 지어내지 마라.
- 한 이름으로 묶이지 않는 잡동사니면 이름 대신 빈 문자열 ""을 넣어라. 억지로 붙이지 마라.
- 사람을 규정하는 이름 금지 ("음악 애호가" X, "신디사이저" O). 주제만 말한다.

JSON만 출력: {"labels":["...","..."]}  (묶음 순서 그대로, 개수 일치)`;

async function label(groups: Frag[][], onUsage?: UsageSink): Promise<string[]> {
  const listing = groups
    .map((g, i) => `[${i + 1}]\n${g.map((f) => `- ${title(f)}`).join('\n')}`)
    .join('\n\n');
  const raw = await complete(
    [
      { role: 'system', content: LABEL_SYS },
      { role: 'user', content: listing },
    ],
    FAST_MODEL,
    onUsage,
  );
  const p = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
  const labels = Array.isArray(p?.labels) ? p.labels : [];
  return groups.map((_, i) => (typeof labels[i] === 'string' ? labels[i].trim() : ''));
}

/**
 * 지금 서 있는 축들을 계산한다. **결과는 어디에도 저장하지 않는다** — 실행 시점 계산, 휘발.
 * 축이 하나도 안 서면 빈 배열 (억지로 만들지 않는다, §2-8).
 */
export async function findAxes(
  supabase: SupabaseClient,
  now = new Date(),
  onUsage?: UsageSink,
): Promise<Axis[]> {
  const { data: edges, error } = await supabase
    .schema('rudy')
    .rpc('cluster_edges', { days: WINDOW_DAYS, min_sim: MIN_SIM });
  if (error) throw error;
  if (!edges?.length) return [];

  const groups = cluster(edges as Edge[], MIN_SIM);
  if (!groups.length) return [];

  const ids = groups.flat();
  const { data: rows } = await supabase.from('fragments').select(FRAG_COLS).in('id', ids);
  const byId = new Map(((rows ?? []) as Frag[]).map((f) => [f.id, f]));

  // 선명도 가중으로 순위 (§6-2: 흐려진 증거는 약하게 반영). 크기순이 아니다 —
  // 오래돼서 다 흐려진 큰 덩어리보다 지금 살아있는 작은 축이 먼저다.
  const ranked = groups
    .map((g) => {
      const items = g.map((id) => byId.get(id)).filter(Boolean) as Frag[];
      items.sort((a, b) => a.created_at.localeCompare(b.created_at));
      const weight = items.reduce((n, f) => n + vividness(f, now), 0);
      return { items, weight, ...shape(items.map((f) => f.created_at), now) };
    })
    .filter((a) => a.items.length >= 3) // 메타 조회 실패로 3개 미만이 됐으면 축이 아니다
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_AXES);
  if (!ranked.length) return [];

  // 축 파편들에 대한 자기 진술을 끌어온다 (배열 겹침). 라벨링과 병렬 — 서로 무관하다.
  const axisIds = ranked.flatMap((a) => a.items.map((f) => f.id));
  const [labels, statements] = await Promise.all([
    label(ranked.map((a) => a.items), onUsage),
    supabase
      .schema('rudy')
      .from('evidence')
      .select('stated_text, related_item_ids')
      .overlaps('related_item_ids', axisIds)
      .then(({ data }) => (data ?? []) as { stated_text: string; related_item_ids: string[] }[]),
  ]);

  // 이름을 못 붙인 묶음은 버린다. LLM이 "잡동사니"라고 한 걸 억지로 축이라 부르지 않는다.
  return ranked
    .map((a, i) => {
      const own = new Set(a.items.map((f) => f.id));
      return {
        ...a,
        label: labels[i],
        stated: statements.filter((s) => s.related_item_ids.some((id) => own.has(id)))
          .map((s) => s.stated_text),
      };
    })
    .filter((a) => a.label);
}

// 모델에 넘길 블록. 시간 모양은 **계산된 사실**로 준다 — 모델이 날짜에서 추론하게 두면
// "요즘 꽂혀 있네" 같은 말을 근거 없이 만든다.
export function axesBlock(axes: Axis[]): string {
  return axes
    .map((a) => {
      const when =
        a.kind === '지속'
          ? `${Math.round(a.spanDays)}일에 걸쳐 ${a.activeDays}번에 나눠 저장`
          : a.kind === '단발'
            ? `${Math.round(a.spanDays) || 1}일 안에 몰아서 저장`
            : `${Math.round(a.spanDays)}일에 걸침`;
      const quiet =
        a.quietDays >= 14 ? `, 마지막 증거 이후 ${Math.round(a.quietDays)}일째 조용함` : '';
      const items = a.items
        .map((f) => `  - ${kstDate(f.created_at)} | ${title(f)} | id: ${f.id}`)
        .join('\n');
      // 유저가 직접 말한 것. 추측이 아니라 확인된 사실이므로 별도 줄로 구분해서 준다.
      const stated = a.stated.length
        ? `\n  본인 진술: ${a.stated.map((s) => `"${s.replace(/\n/g, ' ')}"`).join(' / ')}`
        : '';
      return `축: ${a.label} (${a.kind} · 파편 ${a.items.length}개 · ${when}${quiet})\n${items}${stated}`;
    })
    .join('\n\n');
}
