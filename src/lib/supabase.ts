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

export async function fetchFragments(filter: FeedFilter, page = 0): Promise<Fragment[]> {
  if (!isConfigured) {
    const { fixtureListFragments } = await import('./fixtures');
    return page === 0 ? fixtureListFragments(filter) : [];
  }
  let q = supabase()
    .from('fragments')
    .select('*')
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (filter === 'grave') q = q.eq('archived', true);
  else {
    q = q.eq('archived', false);
    if (filter === 'inbox') q = q.is('project_id', null);
    else if (filter !== 'all') q = q.eq('project_id', filter);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function insertFragment(input: {
  content: string;
  type: FragmentType;
  project_id?: string | null;
  image_path?: string | null;
  link_title?: string | null;
}): Promise<Fragment> {
  if (!isConfigured) {
    const { fixtureInsertFragment } = await import('./fixtures');
    return fixtureInsertFragment(input);
  }
  const { data, error } = await supabase().from('fragments').insert(input).select().single();
  if (error) throw error;
  return data;
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
    .select('*')
    .or(`content.ilike.%${q}%,link_title.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}

export async function getFragment(id: string): Promise<Fragment> {
  if (!isConfigured) {
    const { fixtureGetFragment } = await import('./fixtures');
    return fixtureGetFragment(id);
  }
  const { data, error } = await supabase().from('fragments').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
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

export async function updateFragment(id: string, patch: Partial<Fragment>): Promise<void> {
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

export async function fetchProjects(): Promise<Project[]> {
  if (!isConfigured) {
    const { fixtureListProjects } = await import('./fixtures');
    return fixtureListProjects();
  }
  const { data, error } = await supabase().from('projects').select('*').order('created_at');
  if (error) throw error;
  return data;
}
