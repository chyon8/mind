// Supabase 미설정(isConfigured=false) 상태에서 화면을 테스트하기 위한 하드코딩 데이터.
// 백엔드 연결 후에도 삭제하지 않아도 됨 — supabase.ts가 자동으로 이쪽을 안 탄다.
import type { Fragment, FragmentType, Project } from './types';
import type { FeedFilter } from './supabase';

const NOW = Date.now();
// days일 + hours시간 전 시각 (미래가 나오지 않도록 전부 과거 오프셋)
const ago = (days: number, hours = 0) =>
  new Date(NOW - days * 86_400_000 - hours * 3_600_000).toISOString();

let projects: Project[] = [
  {
    id: 'p-side',
    created_at: ago(90),
    name: '사이드 프로젝트',
    status: 'active',
    started_at: '2026-03-02',
    description: '앱/도구 만들기 실험실. Mind도 여기서 나왔다.',
  },
  {
    id: 'p-write',
    created_at: ago(120),
    name: '글쓰기',
    status: 'paused',
    started_at: '2026-01-10',
    description: null,
  },
  {
    id: 'p-move',
    created_at: ago(10),
    name: '이사 준비',
    status: 'before',
    started_at: null,
    description: null,
  },
  {
    id: 'p-port',
    created_at: ago(200),
    name: '포트폴리오 개편',
    status: 'done',
    started_at: '2025-11-01',
    description: '끝난 프로젝트. 기록용.',
  },
];

const f = (
  id: string,
  createdAt: string,
  content: string,
  type: FragmentType,
  extra: Partial<Fragment> = {},
): Fragment => ({
  id,
  created_at: createdAt,
  content,
  type,
  link_title: null,
  link_thumbnail_url: null,
  image_path: null,
  last_touched_at: createdAt,
  tier: 'normal',
  archived: false,
  touch_count: 0,
  let_go_at: null,
  project_ids: [],
  ...extra,
});

let store: Fragment[] = [
  // ── 오늘 (100%)
  f('fx-01', ago(0, 1), '파편은 던진 순간 선명하고, 시간이 지나면 흐려지고, 건드리면 다시 선명해진다', 'text'),
  f('fx-02', ago(0, 3), 'https://vercel.com/blog/geist', 'link', {
    link_title: 'Geist — Vercel Design System',
    link_thumbnail_url: 'https://picsum.photos/seed/geist/200/200',
  }),
  f('fx-03', ago(0, 5), '"단순함은 궁극의 정교함이다"', 'quote'),
  f('fx-04', ago(0, 8), 'Ship early, ship often — but never ship silence.', 'text'),
  // ── 어제
  f('fx-05', ago(1, 2), '앱 아이콘은 검은 바탕에 흐려지는 점 하나면 충분할 것 같다', 'text', {
    project_ids: ['p-side'],
  }),
  f('fx-06', ago(1, 6), 'www.youtube.com/watch?v=dQw4w9WgXcQ', 'link'), // 제목 백필 전 상태
  // ── 2~6일 (아직 100%)
  f('fx-07', ago(2, 4), '회사 앞 카페 이름이 왜 자꾸 바뀌는지에 대한 짧은 글감', 'text', {
    project_ids: ['p-write'],
  }),
  f('fx-08', ago(3, 1), '', 'image', { image_path: 'fixture-sunset.jpg' }),
  f(
    'fx-09',
    ago(5, 3),
    '기억의 구조에 대해:\n1. 저장은 자동이어야 한다\n2. 인출은 우연이어야 한다\n3. 망각은 기능이어야 한다\n\n이 세 줄이 앱 전체 설계를 요약한다. 특히 3번 — 잊히는 것을 버그가 아니라 기능으로 만드는 것.',
    'text',
    { project_ids: ['p-side', 'p-write'] }, // 다대다 매핑 데모 — 두 프로젝트에 동시에 속함
  ),
  // ── 감쇠 구간 (normal: 7일부터 흐려짐)
  f('fx-10', ago(9, 2), '지하철에서 본 광고 카피. 문장이 리듬을 갖는 순간 기억에 남는다', 'text'), // ~93%
  f('fx-11', ago(14, 5), '신은 죽었다\n— 니체', 'quote'), // ~77%
  f('fx-12', ago(20, 3), '선명도라는 단어보다 "체온"이 나았을까', 'text'), // ~57%
  f('fx-13', ago(28, 1), 'https://maggieappleton.com/garden-history', 'link', {
    link_title: 'A Brief History & Ethos of the Digital Garden',
  }), // ~32%
  // ── 바닥 (25%)
  f('fx-14', ago(45, 2), '바닥에 가라앉은 파편. 그래도 리스트에는 남는다', 'text'),
  // ── important (30일부터 감쇠, 90일 바닥)
  f('fx-15', ago(40, 4), 'https://supabase.com/docs/guides/api', 'link', {
    link_title: 'Supabase REST API Guide',
    tier: 'important',
  }), // ~87%
  f('fx-16', ago(100, 2), '중요 표시해도 결국 가라앉는다. 그게 정상이다', 'text', {
    tier: 'important',
  }), // 바닥
  // ── pinned (감쇠 없음)
  f('fx-17', ago(60, 3), '"미래를 예측하는 가장 좋은 방법은 그것을 발명하는 것이다"\n— 앨런 케이', 'quote', {
    tier: 'pinned',
  }),
  // ── 오래전에 만들었지만 최근에 열어본 파편 (지층 깊은 곳에서 다시 선명)
  f('fx-18', ago(50, 6), '한 달 전에 던졌는데 어제 다시 열어본 파편. 다시 100%로 떠오른다', 'text', {
    last_touched_at: ago(1, 1),
  }),
  // ── 무덤 (수동으로 묻은 것)
  f('fx-19', ago(33, 2), '묻어둔 파편. 무덤 칩에서만 보인다', 'text', { archived: true }),
];

// ============ 파편 ============

export function fixtureListFragments(filter: FeedFilter): Fragment[] {
  return store
    .filter((fr) => {
      if (filter === 'grave') return fr.archived;
      if (fr.archived) return false;
      if (filter === 'inbox') return fr.project_ids.length === 0;
      if (filter === 'pinned') return fr.tier === 'pinned';
      if (filter !== 'all') return fr.project_ids.includes(filter);
      return true;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function fixtureListFragmentsByRange(fromISO: string, toISO: string): Fragment[] {
  return store
    .filter((fr) => !fr.archived && fr.created_at >= fromISO && fr.created_at < toISO)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function fixtureSearchFragments(query: string): Fragment[] {
  const q = query.toLowerCase();
  return store
    .filter(
      (fr) =>
        fr.content.toLowerCase().includes(q) ||
        (fr.link_title?.toLowerCase().includes(q) ?? false),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function fixtureGetFragment(id: string): Fragment {
  const found = store.find((fr) => fr.id === id);
  if (!found) throw new Error(`fragment not found: ${id}`);
  return found;
}

export function fixtureUpdateFragment(id: string, patch: Partial<Fragment>): void {
  store = store.map((fr) => (fr.id === id ? { ...fr, ...patch } : fr));
}

const LET_GO_COOLDOWN_MS = 60 * 86_400_000;

export function fixtureRecallPool(): Fragment[] {
  const cutoff = Date.now() - LET_GO_COOLDOWN_MS;
  return store
    .filter((fr) => !fr.archived)
    .filter((fr) => fr.let_go_at == null || new Date(fr.let_go_at).getTime() < cutoff)
    .sort((a, b) => a.last_touched_at.localeCompare(b.last_touched_at));
}

export function fixtureFragmentsByIds(ids: string[]): Fragment[] {
  return store.filter((fr) => ids.includes(fr.id));
}

export function fixtureSetFragmentProjects(id: string, projectIds: string[]): void {
  fixtureUpdateFragment(id, { project_ids: projectIds });
}

export function fixtureDeleteFragment(id: string): void {
  store = store.filter((fr) => fr.id !== id);
}

export function fixtureInsertFragment(input: {
  content: string;
  type: FragmentType;
  project_ids?: string[];
  image_path?: string | null;
  link_title?: string | null;
}): Fragment {
  const created = new Date().toISOString();
  const fragment = f(`fx-new-${Date.now()}`, created, input.content, input.type, {
    project_ids: input.project_ids ?? [],
    image_path: input.image_path ?? null,
    link_title: input.link_title ?? null,
  });
  store = [fragment, ...store];
  return fragment;
}

// ============ 프로젝트 ============

function withCount(p: Project): Project {
  return {
    ...p,
    fragment_count: store.filter((fr) => !fr.archived && fr.project_ids.includes(p.id)).length,
  };
}

export function fixtureListProjects(): Project[] {
  return projects.map(withCount);
}

export function fixtureGetProject(id: string): Project {
  const found = projects.find((p) => p.id === id);
  if (!found) throw new Error(`project not found: ${id}`);
  return withCount(found);
}

export function fixtureCreateProject(name: string): Project {
  const project: Project = {
    id: `p-new-${Date.now()}`,
    created_at: new Date().toISOString(),
    name,
    status: 'before',
    started_at: null,
    description: null,
  };
  projects = [...projects, project];
  return { ...project, fragment_count: 0 };
}

export function fixtureUpdateProject(id: string, patch: Partial<Project>): void {
  projects = projects.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

export function fixtureDeleteProject(id: string): void {
  projects = projects.filter((p) => p.id !== id);
  // 매핑만 사라지고 파편은 살아남는다
  store = store.map((fr) =>
    fr.project_ids.includes(id)
      ? { ...fr, project_ids: fr.project_ids.filter((pid) => pid !== id) }
      : fr,
  );
}
