import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DayMark, Fragment, FragmentType, MergedPiece, Project } from './types';

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

// ============ 인증 (PLAN.md §2.2) ============
// 사용자 1명. 회원가입 흐름 없음 — 계정은 Supabase 대시보드에서 수동 생성.
// 세션은 AsyncStorage에 유지되므로 로그인은 기기당 한 번뿐이다.

export async function hasSession(): Promise<boolean> {
  if (!isConfigured) return true; // 픽스처 모드 — 로그인 없이 통과
  const { data } = await supabase().auth.getSession();
  return data.session != null;
}

export function onAuthChange(cb: (signedIn: boolean) => void): () => void {
  if (!isConfigured) return () => {};
  const { data } = supabase().auth.onAuthStateChange((_e, session) => cb(session != null));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export const PAGE_SIZE = 100;

// 'all' | 'inbox' | 'pinned' | 'grave' | 프로젝트 id
// pinned = 즐겨찾기. 새 개념이 아니라 tier의 pinned를 모아 보는 렌즈일 뿐이다.
export type FeedFilter = 'all' | 'inbox' | 'pinned' | 'grave' | (string & {});

function isLens(filter: FeedFilter): boolean {
  return filter === 'all' || filter === 'inbox' || filter === 'pinned' || filter === 'grave';
}

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
  if (!isLens(filter)) {
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
      if (filter === 'pinned') q = q.eq('tier', 'pinned');
    }
  }
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (error) throw error;
  return data.map(toFragment);
}

// 월 캘린더용 — 날짜별 밀도만 알면 되므로 원문 없이 가볍게 전부 가져온다.
// 피드는 100개씩 끊어 읽지만 캘린더는 아직 안 읽은 날에도 점을 찍어야 한다.
export async function fetchDayIndex(filter: FeedFilter): Promise<DayMark[]> {
  if (!isConfigured) {
    const { fixtureListFragments } = await import('./fixtures');
    return fixtureListFragments(filter);
  }
  const cols = 'id, created_at, last_touched_at, tier, touch_count';
  let q;
  if (!isLens(filter)) {
    q = supabase()
      .from('fragments')
      .select(`${cols}, fragment_projects!inner(project_id)`)
      .eq('fragment_projects.project_id', filter)
      .eq('archived', false);
  } else {
    q = supabase().from('fragments').select(`${cols}, fragment_projects(project_id)`);
    if (filter === 'grave') q = q.eq('archived', true);
    else {
      q = q.eq('archived', false);
      if (filter === 'inbox') q = q.is('fragment_projects', null);
      if (filter === 'pinned') q = q.eq('tier', 'pinned');
    }
  }
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return data as DayMark[];
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

// 제목이 아직 안 붙은 링크 파편 — 포그라운드 백필 대상 (PLAN.md §3.6)
export async function fetchLinksMissingMeta(
  limit: number,
): Promise<{ id: string; content: string }[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase()
    .from('fragments')
    .select('id, content')
    .eq('type', 'link')
    .is('link_title', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// 공유받은 이미지를 Storage에 올린다 → image_path 반환 (PLAN.md §2.3, §4)
export async function uploadImage(uri: string, mimeType: string): Promise<string> {
  const ext = mimeType.split('/')[1] ?? 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bytes = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase()
    .storage.from('images')
    .upload(path, bytes, { contentType: mimeType });
  if (error) throw error;
  return path;
}

// images 버킷이 private이라 표시에도 서명 URL이 필요하다 (PLAN.md §2.3).
// Promise를 캐시해 같은 이미지를 여러 카드가 동시에 요구해도 발급은 한 번만 나간다.
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 1주
const signedUrls = new Map<string, Promise<string>>();

export function getImageUrl(path: string): Promise<string> {
  if (!isConfigured) return Promise.resolve(''); // 픽스처 이미지는 실제 파일이 없다
  let pending = signedUrls.get(path);
  if (!pending) {
    pending = supabase()
      .storage.from('images')
      .createSignedUrl(path, SIGNED_URL_TTL)
      .then(({ data, error }) => {
        if (error) {
          signedUrls.delete(path); // 실패는 캐시하지 않는다 — 다음 렌더에서 재시도
          throw error;
        }
        return data.signedUrl;
      });
    signedUrls.set(path, pending);
  }
  return pending;
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

// ============ 회상 (SPEC §5의 없어진 반쪽) ============

const LET_GO_COOLDOWN_DAYS = 60;

// 회상 후보 — 가장 오래 안 건드린 것부터. 흘려보낸 지 얼마 안 된 건 뺀다.
// 어느 게 실제로 잊히기 직전인지는 선명도를 계산해봐야 알므로 판정은 recall.ts에서.
export async function fetchRecallPool(): Promise<Fragment[]> {
  if (!isConfigured) {
    const { fixtureRecallPool } = await import('./fixtures');
    return fixtureRecallPool();
  }
  const cooldown = new Date(Date.now() - LET_GO_COOLDOWN_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase()
    .from('fragments')
    .select(EMBED)
    .eq('archived', false)
    .or(`let_go_at.is.null,let_go_at.lt.${cooldown}`)
    .order('last_touched_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return data.map(toFragment);
}

export async function fetchFragmentsByIds(ids: string[]): Promise<Fragment[]> {
  if (ids.length === 0) return [];
  if (!isConfigured) {
    const { fixtureFragmentsByIds } = await import('./fixtures');
    return fixtureFragmentsByIds(ids);
  }
  const { data, error } = await supabase().from('fragments').select(EMBED).in('id', ids);
  if (error) throw error;
  return data.map(toFragment);
}

// 구해냈다 — 선명도 100% 복귀 + 중요도 한 칸. 회상에서 "기억하기"를 누를 때만.
export async function rememberFragment(fr: Fragment): Promise<void> {
  await updateFragment(fr.id, {
    last_touched_at: new Date().toISOString(),
    touch_count: fr.touch_count + 1,
  });
}

// 흘려보냈다 — 파편은 그대로 두고(삭제도 아카이브도 아니다) 당분간 다시 띄우지 않는다
export async function letGoFragment(id: string): Promise<void> {
  await updateFragment(id, { let_go_at: new Date().toISOString() });
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

// DB 행만 지운다 — Storage는 건드리지 않는다. 합치기로 사라지는 조각은
// image_path가 대표 파편의 merged_from에 스냅샷으로 남으므로 파일을 지우면 안 된다.
async function deleteFragmentRow(id: string): Promise<void> {
  if (!isConfigured) {
    const { fixtureDeleteFragment } = await import('./fixtures');
    return fixtureDeleteFragment(id);
  }
  const { error } = await supabase().from('fragments').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteFragment(fragment: Fragment): Promise<void> {
  if (isConfigured && fragment.image_path) {
    await supabase().storage.from('images').remove([fragment.image_path]); // 고아 파일 방지
    signedUrls.delete(fragment.image_path);
  }
  await deleteFragmentRow(fragment.id);
}

// 여러 파편을 하나로 합친다 — 관계를 저장하는 게 아니라 파괴적 병합이다 (SPEC §7 재검토, 2026-07-15).
// 대표 = 가장 최근 파편. 마찰 0 — 요약/제목 입력을 요구하지 않고 대표의 content를 그대로 쓴다.
// project_ids는 합집합(프로젝트는 렌즈이므로 필터에서 조용히 사라지면 안 된다),
// tier·touch_count는 대표 값을 그대로 유지(새 합산 규칙을 만들지 않는다).
export async function mergeFragments(ids: string[]): Promise<Fragment> {
  const frs = await fetchFragmentsByIds(ids);
  const [representative, ...rest] = [...frs].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  // 흡수되는 조각 + 그 조각이 이미 품고 있던 조각들(재합치기 시 평평하게 편다)
  const absorbed: MergedPiece[] = rest.flatMap((fr) => [
    { content: fr.content, type: fr.type, created_at: fr.created_at, image_path: fr.image_path },
    ...fr.merged_from,
  ]);
  const mergedFrom = [...representative.merged_from, ...absorbed].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const projectIds = Array.from(new Set(frs.flatMap((fr) => fr.project_ids)));
  const lastTouchedAt = new Date().toISOString(); // 합치기는 명백히 손을 댄 행위 — touch

  await updateFragment(representative.id, { merged_from: mergedFrom, last_touched_at: lastTouchedAt });
  await setFragmentProjects(representative.id, projectIds);
  for (const fr of rest) await deleteFragmentRow(fr.id);

  return { ...representative, merged_from: mergedFrom, project_ids: projectIds, last_touched_at: lastTouchedAt };
}

// 펼치기 — 합친 걸 되돌린다. 조각들을 원래 날짜/타입/이미지로 되살리고 대표는 조각을 비운다.
// 프로젝트·tier는 스냅샷에 없으므로 복원 안 됨(Inbox·normal로 돌아온다) — 파괴적 병합의 대가.
export async function unmergeFragment(fragment: Fragment): Promise<void> {
  if (fragment.merged_from.length === 0) return;
  if (!isConfigured) {
    const { fixtureUnmergeFragment } = await import('./fixtures');
    return fixtureUnmergeFragment(fragment);
  }
  const rows = fragment.merged_from.map((p) => ({
    content: p.content,
    type: p.type,
    created_at: p.created_at,
    last_touched_at: p.created_at, // 합치기 전 선명도 상태로 되돌아간다
    image_path: p.image_path,
  }));
  const { error } = await supabase().from('fragments').insert(rows);
  if (error) throw error;
  await updateFragment(fragment.id, { merged_from: [] });
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
