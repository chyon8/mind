// 발견 브리핑의 재료 로드 (RUDY-DISCOVERY.md §2 원리 B — 성격별로 갈라 읽는다).
//
// ⚠️ flat하게 합치면 안 된다. 이 세션에서 유저가 화낸 지점이 정확히 이거였다:
//    진행 중 프로젝트(진짜 일) / 💡(아직 안 정한 아이디어) / 글감(에세이 소재) /
//    미소속 파편(북마크·관찰)은 완전히 다른 재료다. 같은 파이프라인에 넣으면 헛것이 나온다.
//
// ⚠️ 프로젝트 description을 반드시 싣는다. 이걸 안 읽어서 No phone을 미니멀폰으로,
//    Caselab을 법률 프로덕트로 읽는 헛발질이 났다 (원리 A). description은 유일한 정답지다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { kstDate } from '../_shared/time.ts';

export type Frag = {
  id: string;
  created_at: string;
  type: string;
  content: string;
  link_title: string | null;
  link_description: string | null;
  note: string | null;
};

export type Project = {
  name: string;
  status: string; // 'active' = 진행 중 / 'before' = 수집·미착수
  description: string | null;
  fragments: Frag[];
};

export type Material = {
  projects: Project[];
  loose: Frag[]; // 어느 프로젝트에도 안 묶인 파편 — 북마크·관찰. 확장(원리 C)의 씨앗.
};

const FRAG_COLS = 'id, created_at, type, content, link_title, link_description, note';
const WINDOW_DAYS = 90; // §6-2 창. 지금은 코퍼스가 5일치라 사실상 전부.

export async function loadMaterial(supabase: SupabaseClient): Promise<Material> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [projRes, fragRes, mapRes] = await Promise.all([
    supabase.from('projects').select('id, name, status, description').order('created_at'),
    supabase
      .from('fragments')
      .select(FRAG_COLS)
      .eq('archived', false)
      .gte('created_at', since)
      .order('created_at', { ascending: false }),
    supabase.from('fragment_projects').select('fragment_id, project_id'),
  ]);

  const frags = (fragRes.data ?? []) as Frag[];
  const fragById = new Map(frags.map((f) => [f.id, f]));
  const maps = (mapRes.data ?? []) as { fragment_id: string; project_id: string }[];

  const byProject = new Map<string, Frag[]>();
  const inProject = new Set<string>();
  for (const m of maps) {
    inProject.add(m.fragment_id);
    const f = fragById.get(m.fragment_id);
    if (!f) continue; // 창 밖이거나 archived
    const arr = byProject.get(m.project_id) ?? [];
    arr.push(f);
    byProject.set(m.project_id, arr);
  }

  const projects = ((projRes.data ?? []) as { id: string; name: string; status: string; description: string | null }[])
    .map((p) => ({
      name: p.name,
      status: p.status,
      description: p.description,
      fragments: byProject.get(p.id) ?? [],
    }))
    .filter((p) => p.fragments.length > 0); // 이 창에 파편 없는 프로젝트는 뺀다

  const loose = frags.filter((f) => !inProject.has(f.id));
  return { projects, loose };
}

// 파편 한 줄. 링크는 제목·설명(og)까지 — 북마크가 뭔지 알아야 원리 C(북마크×프로젝트 겹치기)가 된다.
function fragLine(f: Frag): string {
  const date = kstDate(f.created_at);
  const title = f.type === 'link' && f.link_title ? `『${f.link_title}』 ` : '';
  const body = (f.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const desc = f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 120)}` : '';
  const note = f.note ? ` (덧: ${f.note.replace(/\s+/g, ' ').slice(0, 80)})` : '';
  return `  - ${date} [${f.type}] ${title}${body}${desc}${note} {id:${f.id}}`;
}

// 모델에 넘길 재료 블록. 성격이 섞이지 않게 구획을 나눠서 준다.
export function materialBlock(m: Material): string {
  const projects = m.projects
    .map((p) =>
      [
        `[프로젝트: ${p.name}] (${p.status})`,
        `  설명: ${p.description ?? '(없음)'}`,
        ...p.fragments.map(fragLine),
      ].join('\n'),
    )
    .join('\n\n');

  const loose = m.loose.map(fragLine).join('\n');

  return [
    '=== 진행 중인 일 / 아이디어 수집 (프로젝트별) ===',
    '※ status=active는 지금 만드는 일. 그 외(💡·글감·포폴용 등)는 이름이 성격을 말한다.',
    '※ 글감은 에세이 소재다 — 프로덕트처럼 다루지 마라.',
    projects || '(없음)',
    '',
    '=== 어디에도 안 묶인 파편 (북마크·관찰·스치는 생각) ===',
    '※ 저장한 링크가 여기 많다. 프로젝트 설명과 겹쳐 봐라(원리 C).',
    loose || '(없음)',
  ].join('\n');
}
