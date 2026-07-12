import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Fragment, FragmentType, Project } from './types';

// 키는 .env의 EXPO_PUBLIC_* — anon key는 공개 가능 전제, RLS가 방어선 (PLAN.md §2.2)
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isConfigured = url.length > 0 && anonKey.length > 0;

// 키가 비어 있으면 createClient가 throw하므로 lazy 생성.
// 미설정 상태에서는 각 함수의 픽스처 가드가 먼저 반환되어 여기까지 오지 않는다.
let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  client ??= createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

const PAGE_SIZE = 100;

// 'all' | 'inbox' | 'grave' | 프로젝트 id
export type FeedFilter = 'all' | 'inbox' | 'grave' | (string & {});

const EMBED = '*, fragment_projects(project_id)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFragment(row: any): Fragment {
  const { fragment_projects, ...rest } = row;
  return {
    ...rest,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    project_ids: (fragment_projects ?? []).map((m: any) => m.project_id),
  };
}

export async function fetchFragments(filter: FeedFilter, page = 0): Promise<Fragment[]> {
  if (!isConfigured) {
    const { fixtureListFragments } = await import('./fixtures');
    return page === 0 ? fixtureListFragments(filter) : [];
  }
  let q;
  if (filter !== 'all' && filter !== 'inbox' && filter !== 'grave') {
    // 프로젝트 렌즈 — inner join으로 해당 프로젝트에 매핑된 파편만
    q = supabase()
      .from('fragments')
      .select('*, fragment_projects!inner(project_id)')
      .eq('fragment_projects.project_id', filter)
      .eq('archived', false);
  } else {
    q = supabase().from('fragments').select(EMBED);
    if (filter === 'grave') q = q.eq('archived', true);
    else {
      q = q.eq('archived', false);
      if (filter === 'inbox') q = q.is('fragment_projects', null); // 매핑 0개 = Inbox
    }
  }
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (error) throw error;
  return data.map(toFragment);
}

// 데일리 뷰: 주 단위 범위 조회 (무덤 제외)
export async function fetchFragmentsByRange(fromISO: string, toISO: string): Promise<Fragment[]> {
  if (!isConfigured) {
    const { fixtureListFragmentsByRange } = await import('./fixtures');
    return fixtureListFragmentsByRange(fromISO, toISO);
  }
  const { data, error } = await supabase()
    .from('fragments')
    .select(EMBED)
    .eq('archived', false)
    .gte('created_at', fromISO)
    .lt('created_at', toISO)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(toFragment);
}

// 검색: 원문 + 링크 제목. 무덤 포함 전부 뒤진다 — 찾으려고 들어온 사람에게 숨길 이유가 없다.
export async function searchFragments(query: string): Promise<Fragment[]> {
  const q = query.trim();
  if (!q) return [];
  if (!isConfigured) {
    const { fixtureSearchFragments } = await import('./fixtures');
    return fixtureSearchFragments(q);
  }
  const { data, error } = await supabase()
    .from('fragments')
    .select(EMBED)
    .or(`content.ilike.%${q}%,link_title.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data.map(toFragment);
}

export async function getFragment(id: string): Promise<Fragment> {
  if (!isConfigured) {
    const { fixtureGetFragment } = await import('./fixtures');
    return fixtureGetFragment(id);
  }
  const { data, error } = await supabase().from('fragments').select(EMBED).eq('id', id).single();
  if (error) throw error;
  return toFragment(data);
}

export async function insertFragment(input: {
  content: string;
  type: FragmentType;
  project_ids?: string[];
  image_path?: string | null;
  link_title?: string | null;
}): Promise<Fragment> {
  if (!isConfigured) {
    const { fixtureInsertFragment } = await import('./fixtures');
    return fixtureInsertFragment(input);
  }
  const { project_ids, ...fields } = input;
  const { data, error } = await supabase().from('fragments').insert(fields).select().single();
  if (error) throw error;
  const fragment = { ...toFragment(data), project_ids: project_ids ?? [] };
  if (project_ids?.length) await setFragmentProjects(fragment.id, project_ids);
  return fragment;
}

// 파편 ↔ 프로젝트 매핑 전체 교체 (다대다, PLAN.md §3.3)
export async function setFragmentProjects(fragmentId: string, projectIds: string[]): Promise<void> {
  if (!isConfigured) {
    const { fixtureSetFragmentProjects } = await import('./fixtures');
    return fixtureSetFragmentProjects(fragmentId, projectIds);
  }
  const { error: delError } = await supabase()
    .from('fragment_projects')
    .delete()
    .eq('fragment_id', fragmentId);
  if (delError) throw delError;
  if (projectIds.length === 0) return;
  const { error } = await supabase()
    .from('fragment_projects')
    .insert(projectIds.map((project_id) => ({ fragment_id: fragmentId, project_id })));
  if (error) throw error;
}

// 파편을 열면 100% 복귀 — 유일한 last_touched_at 갱신 지점 (PLAN.md §3.2)
export async function touchFragment(id: string): Promise<void> {
  const touched = { last_touched_at: new Date().toISOString() };
  if (!isConfigured) {
    const { fixtureUpdateFragment } = await import('./fixtures');
    return fixtureUpdateFragment(id, touched);
  }
  const { error } = await supabase().from('fragments').update(touched).eq('id', id);
  if (error) throw error;
}

export async function updateFragment(
  id: string,
  patch: Partial<Omit<Fragment, 'project_ids'>>,
): Promise<void> {
  if (!isConfigured) {
    const { fixtureUpdateFragment } = await import('./fixtures');
    return fixtureUpdateFragment(id, patch);
  }
  const { error } = await supabase().from('fragments').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteFragment(fragment: Fragment): Promise<void> {
  if (!isConfigured) {
    const { fixtureDeleteFragment } = await import('./fixtures');
    return fixtureDeleteFragment(fragment.id);
  }
  if (fragment.image_path) {
    await supabase().storage.from('images').remove([fragment.image_path]); // 고아 파일 방지
  }
  const { error } = await supabase().from('fragments').delete().eq('id', fragment.id);
  if (error) throw error;
}

// ============ 프로젝트 ============

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProject(row: any): Project {
  const { fragment_projects, ...rest } = row;
  return { ...rest, fragment_count: fragment_projects?.[0]?.count ?? 0 };
}

export async function fetchProjects(): Promise<Project[]> {
  if (!isConfigured) {
    const { fixtureListProjects } = await import('./fixtures');
    return fixtureListProjects();
  }
  const { data, error } = await supabase()
    .from('projects')
    .select('*, fragment_projects(count)')
    .order('created_at');
  if (error) throw error;
  return data.map(toProject);
}

export async function getProject(id: string): Promise<Project> {
  if (!isConfigured) {
    const { fixtureGetProject } = await import('./fixtures');
    return fixtureGetProject(id);
  }
  const { data, error } = await supabase()
    .from('projects')
    .select('*, fragment_projects(count)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return toProject(data);
}

// 만들 때는 이름만 — 여기서도 마찰 0 (PLAN.md §6.2)
export async function createProject(name: string): Promise<Project> {
  if (!isConfigured) {
    const { fixtureCreateProject } = await import('./fixtures');
    return fixtureCreateProject(name);
  }
  const { data, error } = await supabase().from('projects').insert({ name }).select().single();
  if (error) throw error;
  return { ...data, fragment_count: 0 };
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  const { fragment_count: _omit, ...fields } = patch;
  if (!isConfigured) {
    const { fixtureUpdateProject } = await import('./fixtures');
    return fixtureUpdateProject(id, fields);
  }
  const { error } = await supabase().from('projects').update(fields).eq('id', id);
  if (error) throw error;
}

// 프로젝트를 지워도 파편은 살아남는다 — 매핑만 cascade로 사라진다
export async function deleteProject(id: string): Promise<void> {
  if (!isConfigured) {
    const { fixtureDeleteProject } = await import('./fixtures');
    return fixtureDeleteProject(id);
  }
  const { error } = await supabase().from('projects').delete().eq('id', id);
  if (error) throw error;
}
