// 어제 관찰 한 줄 + 아침 브리핑 하루 1회 상한 (RUDY.md §4-F4·§4-F5 · §10-8).
//
// pg_cron(폐기됨, 2026-07-22)과 discovery의 수동 '모닝 브리핑' 버튼이 이 상한을 공유한다 —
// 갈라놓으면 나중에 뭔가(크론을 다시 켜거나, 다른 경로가 생기거나) 하루 2번 나가는 구멍이 생긴다.
// 진실은 하나: trigger='push' 원장이 오늘 이미 있는가.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { kstRange } from '../_shared/time.ts';

export async function alreadyMorningToday(supabase: SupabaseClient): Promise<boolean> {
  const { since } = kstRange('today');
  const { data } = await supabase
    .schema('rudy')
    .from('utterances')
    .select('id')
    .eq('kind', 'discovery')
    .eq('surface', 'briefing')
    .eq('trigger', 'push')
    .gte('created_at', since)
    .limit(1);
  return !!data?.length;
}

type ProjectCount = { name: string; status: string; count: number };

// 어제(KST) 프로젝트별 저장 개수. §4-F5: "이번 주의 너"는 규정이 아니라 스냅샷 — 숫자를 말해도
// 처방("오늘은 X 하세요")만 안 섞으면 관찰이다. 아무 신호도 없으면 관찰 자체를 생략한다(§2-8).
export async function observationLine(supabase: SupabaseClient): Promise<string> {
  const { since, until } = kstRange('yesterday');
  const [{ data: projects }, { data: frags }, { data: maps }] = await Promise.all([
    supabase.from('projects').select('id, name, status').eq('status', 'active'),
    supabase.from('fragments').select('id').eq('archived', false).gte('created_at', since).lt('created_at', until),
    supabase.from('fragment_projects').select('fragment_id, project_id'),
  ]);
  const yesterdayIds = new Set((frags ?? []).map((f) => f.id as string));
  const counts = new Map<string, number>();
  for (const m of maps ?? []) {
    if (!yesterdayIds.has(m.fragment_id as string)) continue;
    counts.set(m.project_id as string, (counts.get(m.project_id as string) ?? 0) + 1);
  }
  const withCount: ProjectCount[] = (projects ?? [])
    .map((p) => ({ name: p.name as string, status: p.status as string, count: counts.get(p.id as string) ?? 0 }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  if (!withCount.length) return ''; // 어제 아무 프로젝트도 안 건드렸다 — 침묵이 낫다. 지어내지 않는다.
  const parts = withCount.slice(0, 3).map((p) => `${p.name}에 ${p.count}개`);
  return `어제는 ${parts.join(', ')} 남겼다.`;
}
