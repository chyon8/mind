// "오늘 뭐 봐야 할까" — 판단을 구하는 질문 (RUDY-STATUS.md §10-9, 2026-07-22 설계).
//
// 핵심 = 축(경향) × 흐림(감쇠)의 교집합. 축만 보면 "요즘 뭐에 꽂혔어"랑 같고, 흐림만 보면
// 그냥 랜덤 회상이다. "네가 꽂혔던 결인데, 그중 지금 흐려지는 것"이 이 경로가 답하는 질문이다.
//
// 회상 엔진(recall.ts)과 판단 기준을 맞춘다: NEAR_FLOOR=0.7(아직 흐려지고 있는 중), 흘려보낸
// 것(let_go_at)은 제외. 클러스터 엔진(rudy-cluster.sql)이 let_go_at을 안 거르는 것과는 다르다 —
// 거긴 "그때 저장했다는 사실 자체가 증거"인 자리고, 여긴 "오늘 다시 보여줄 것을 고르는" 자리라
// 목적이 회상 엔진과 같다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { findAxes } from './clusters.ts';
import { vividness } from '../_shared/cluster.ts';
import { kstDate } from '../_shared/time.ts';
import type { UsageSink } from '../_shared/openai.ts';

const NEAR_FLOOR = 0.7; // recall.ts와 같은 기준

type Pick = { id: string; title: string; createdAt: string };
export type OrientResult = {
  axisPicks: { axisLabel: string; items: Pick[] }[];
  projectPicks: { projectName: string; items: Pick[] }[];
};

const titleOf = (f: { type: string; content: string; link_title: string | null }) =>
  ((f.type === 'link' ? f.link_title ?? f.content : f.content) ?? '').replace(/\s+/g, ' ').slice(0, 60);

export async function buildOrient(
  supabase: SupabaseClient,
  now = new Date(),
  onUsage?: UsageSink,
  meta?: Record<string, string>,
): Promise<OrientResult | null> {
  const axes = await findAxes(supabase, now, onUsage, meta);

  // 축 안에서 흐려지는 것만 (교집합) — 살아있는 축 전체를 다시 나열하지 않는다.
  const axisCandidates = axes
    .map((a) => ({
      axisLabel: a.label,
      items: a.items.filter((f) => vividness(f, now) <= NEAR_FLOOR),
    }))
    .filter((a) => a.axisLabel && a.items.length > 0);

  const axisItemIds = axisCandidates.flatMap((a) => a.items.map((f) => f.id));

  // active 프로젝트에 걸린 흐려지는 파편 — 축에 이미 잡힌 건 빼고 새로 찾는다.
  const { data: projects } = await supabase.from('projects').select('id, name').eq('status', 'active');
  const projFrag: { fragment_id: string; project_id: string }[] = projects?.length
    ? ((
        await supabase
          .from('fragment_projects')
          .select('fragment_id, project_id')
          .in(
            'project_id',
            projects.map((p) => p.id),
          )
      ).data ?? [])
    : [];
  const projFragIds = [...new Set(projFrag.map((m) => m.fragment_id))].filter(
    (id) => !axisItemIds.includes(id),
  );

  // 후보 전체(축+프로젝트)의 let_go_at을 한 번에 확인 — 흘려보낸 건 오늘도 다시 안 꺼낸다.
  const allIds = [...new Set([...axisItemIds, ...projFragIds])];
  if (!allIds.length) return null;
  const { data: letGoRows } = await supabase.from('fragments').select('id, let_go_at').in('id', allIds);
  const letGo = new Set((letGoRows ?? []).filter((f) => f.let_go_at).map((f) => f.id as string));

  const axisPicks = axisCandidates
    .map((a) => ({
      axisLabel: a.axisLabel,
      items: a.items
        .filter((f) => !letGo.has(f.id))
        .map((f) => ({ id: f.id, title: titleOf(f), createdAt: f.created_at })),
    }))
    .filter((a) => a.items.length > 0);

  let projectPicks: OrientResult['projectPicks'] = [];
  const liveProjIds = projFragIds.filter((id) => !letGo.has(id));
  if (liveProjIds.length) {
    const { data: frags } = await supabase
      .from('fragments')
      .select('id, created_at, type, content, link_title, last_touched_at, tier, touch_count')
      .eq('archived', false)
      .in('id', liveProjIds);
    const nameById = new Map(projects!.map((p) => [p.id, p.name as string]));
    const projectByFrag = new Map(projFrag.map((m) => [m.fragment_id, m.project_id]));
    const grouped = new Map<string, Pick[]>();
    for (const f of (frags ?? []) as {
      id: string;
      created_at: string;
      type: string;
      content: string;
      link_title: string | null;
      last_touched_at: string;
      tier: string;
      touch_count: number;
    }[]) {
      if (vividness(f, now) > NEAR_FLOOR) continue;
      const pname = nameById.get(projectByFrag.get(f.id) ?? '');
      if (!pname) continue;
      const arr = grouped.get(pname) ?? [];
      arr.push({ id: f.id, title: titleOf(f), createdAt: f.created_at });
      grouped.set(pname, arr);
    }
    projectPicks = [...grouped.entries()].map(([projectName, items]) => ({
      projectName,
      items: items.slice(0, 3), // 프로젝트 하나당 너무 길게 나열하지 않는다
    }));
  }

  if (!axisPicks.length && !projectPicks.length) return null; // 볼 것 없다 — 침묵(§2-8)
  return { axisPicks, projectPicks };
}

export function orientBlock(o: OrientResult): string {
  const lines: string[] = [];
  for (const a of o.axisPicks) {
    lines.push(
      `축: ${a.axisLabel}\n${a.items.map((i) => `  - ${kstDate(i.createdAt)} | ${i.title} | id: ${i.id}`).join('\n')}`,
    );
  }
  for (const p of o.projectPicks) {
    lines.push(
      `프로젝트: ${p.projectName}\n${p.items.map((i) => `  - ${kstDate(i.createdAt)} | ${i.title} | id: ${i.id}`).join('\n')}`,
    );
  }
  return lines.join('\n\n');
}
