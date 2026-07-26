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
  status: string; // 'active' = 진행 중 / 'before' = 수집·미착수 / 'paused' / 'done'
  description: string | null;
  fragments: Frag[];
};

export type Material = {
  // status='active'인 것만. 여기만 "진행 중 프로젝트 최대 2개" 캡의 대상이다.
  projects: Project[];
  // ⚠️ status!=='active' — 💡·글감·멈춘 것. **이건 프로젝트가 아니라 리스트다** (2026-07-25 유저):
  //    "아이디어 프로젝트는 사실상 프로젝트라기보다 그냥 리스트야. 아이디어들 리스트."
  //    Caselab은 description이 정답지고 파편은 그 일의 부산물이지만, 💡는 **파편 하나하나가
  //    내용 그 자체**다. 같은 구획에 두면 재료가 「프로젝트」라고 말해버려서 캡 싸움에 끌려간다 —
  //    프롬프트로 "미소속처럼 봐라"라고 해봐야 안 먹혔던 이유가 이거다. 구획을 갈라야 캡에서 빠진다.
  lists: Project[];
  loose: Frag[]; // 어느 프로젝트에도 안 묶인 파편 — 북마크·관찰. 확장(원리 C)의 씨앗.
  // 유저가 "다음 발견에 포함"으로 직접 지정한 것 (RUDY-STATUS.md ①). 창(90일)을 안 걸고
  // archived도 안 거른다 — 명시적 지정이 자동 규칙을 이긴다. 브리핑이 쓰고 나면 꺼진다.
  picked: Frag[];
};

const FRAG_COLS = 'id, created_at, type, content, link_title, link_description, note';
const WINDOW_DAYS = 90; // §6-2 창. 지금은 코퍼스가 5일치라 사실상 전부.

export async function loadMaterial(supabase: SupabaseClient): Promise<Material> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [projRes, fragRes, mapRes, pickRes] = await Promise.all([
    supabase.from('projects').select('id, name, status, description').order('created_at'),
    supabase
      .from('fragments')
      .select(FRAG_COLS)
      .eq('archived', false)
      .gte('created_at', since)
      .order('created_at', { ascending: false }),
    supabase.from('fragment_projects').select('fragment_id, project_id'),
    supabase.from('fragments').select(FRAG_COLS).eq('discover_next', true),
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

  const all = ((projRes.data ?? []) as { id: string; name: string; status: string; description: string | null }[])
    .map((p) => ({
      name: p.name,
      status: p.status,
      description: p.description,
      fragments: byProject.get(p.id) ?? [],
    }))
    .filter((p) => p.fragments.length > 0); // 이 창에 파편 없는 프로젝트는 뺀다

  const loose = frags.filter((f) => !inProject.has(f.id));
  return {
    projects: all.filter((p) => p.status === 'active'),
    lists: all.filter((p) => p.status !== 'active'),
    loose,
    picked: (pickRes.data ?? []) as Frag[],
  };
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
        `[프로젝트: ${p.name}]`,
        `  설명: ${p.description ?? '(없음)'}`,
        ...p.fragments.map(fragLine),
      ].join('\n'),
    )
    .join('\n\n');

  // ⚠️ **"프로젝트"라는 단어를 쓰지 않는다.** 이 라벨 하나가 캡 소속을 정한다 —
  //    라벨이 없으면 "진행 중 프로젝트 최대 2개"의 대상이 아님이 구조적으로 성립한다.
  const lists = m.lists
    .map((p) =>
      [
        `[${p.name}]${p.status === 'paused' || p.status === 'done' ? ` (${p.status})` : ''}`,
        ...(p.description ? [`  설명: ${p.description}`] : []),
        ...p.fragments.map(fragLine),
      ].join('\n'),
    )
    .join('\n\n');

  const loose = m.loose.map(fragLine).join('\n');

  // 지정된 게 있을 때만 맨 위에 붙인다 — 빈 구획을 넣으면 모델이 "지정이 있었나" 헷갈린다.
  const picked = m.picked.length
    ? [
        '=== 내가 지정한 것 (유저가 직접 "다음 발견에 포함"을 누른 파편) ===',
        '※ 이건 유저의 명시적 지시다. 반드시 각도로 만들어라.',
        m.picked.map(fragLine).join('\n'),
        '',
      ]
    : [];

  return [
    ...picked,
    '=== 진행 중인 일 (프로젝트) ===',
    '※ 지금 실제로 만들고 있는 것. **설명이 정답지다** — 파편만 보고 넘겨짚지 마라.',
    '※ 여기서 뽑는 각도는 최대 2개까지다 (아래 구성 규칙).',
    projects || '(없음)',
    '',
    '=== 아이디어·수집함 (아직 시작 안 한 것 / 멈춘 것) ===',
    '※ **이건 프로젝트가 아니라 리스트다.** 파편 하나하나가 내용 그 자체다 —',
    '   설명은 정답지가 아니라 그냥 라벨이다. 진행 중인 일의 캡에 걸리지 않는다.',
    '※ 글감은 에세이 소재다 — 프로덕트처럼 다루지 마라.',
    lists || '(없음)',
    '',
    '=== 어디에도 안 묶인 파편 (북마크·관찰·스치는 생각) ===',
    '※ 저장한 링크가 여기 많다. 프로젝트 설명과 겹쳐 봐라(원리 C).',
    loose || '(없음)',
  ].join('\n');
}
