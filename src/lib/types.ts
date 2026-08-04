// PLAN.md §2.1 스키마와 대응
export type FragmentType = 'text' | 'link' | 'image' | 'quote';
export type Tier = 'normal' | 'important' | 'pinned';
export type ProjectStatus = 'before' | 'active' | 'paused' | 'done';

// 합치기로 사라진 조각의 스냅샷. 관계가 아니라 대표 파편 내부에 흡수된 기록.
export interface MergedPiece {
  content: string;
  type: FragmentType;
  created_at: string;
  image_path: string | null;
  note: string | null;
}

export interface Fragment {
  id: string;
  created_at: string;
  content: string;
  type: FragmentType;
  link_title: string | null;
  link_description: string | null; // og:description — 링크 임베딩 신호. 표시 안 함, 검색용
  link_thumbnail_url: string | null;
  image_path: string | null;
  note: string | null; // 덧붙임 — 나중에 붙이는 생각. 상세 화면에서만 편집
  merged_from: MergedPiece[]; // 합치기로 흡수된 조각들 — 날짜순
  last_touched_at: string;
  tier: Tier;
  archived: boolean;
  touch_count: number; // 회상에서 구해낸 횟수 = 자라나는 중요도
  let_go_at: string | null; // 회상에서 흘려보낸 시각. 보여준 것만으론 기록되지 않는다
  // "다음 발견에 포함" 표시. 브리핑이 한 번 돌면 서버가 전부 내린다 — 선명도와 무관하다
  discover_next: boolean;
  // 지정할 때 유저가 고른 슬롯 — 발견이 이걸 [확장]으로 낼지 [아이디어]로 낼지.
  // null = 슬롯 버튼이 생기기 전(2026-08-03)에 눌린 것. 모델이 알아서 고른다.
  discover_next_slot: 'expansion' | 'idea' | null;
  // "발견에서 제외" 표시 — discover_next의 대칭. 켜져 있으면 브리핑 재료에서 빠진다.
  // 발견에만 건다: 채팅·검색은 그대로 다 본다 (discover-skip.sql). 선명도와 무관하다.
  discover_skip: boolean;
  // fragment_projects에서 파생 (클라이언트 전용). 빈 배열 = Inbox
  project_ids: string[];
}

// 캘린더에 점만 찍으면 되는 최소 정보. 날짜별 밀도를 알려고 파편 전체를 들고 올 이유가 없다.
export type DayMark = Pick<
  Fragment,
  'id' | 'created_at' | 'last_touched_at' | 'tier' | 'touch_count'
> & {
  // 렌즈 조회('all'·'inbox' 등)에서만 채워진다. 프로젝트 필터는 !inner 조인이라 그 프로젝트
  // 하나만 돌아오므로 신뢰할 수 없다 — 헤매기의 프로젝트 제외가 '전체'에서만 도는 이유다.
  project_ids?: string[];
};

export interface Project {
  id: string;
  created_at: string;
  name: string;
  status: ProjectStatus;
  started_at: string | null; // YYYY-MM-DD
  description: string | null;
  // 발견 재료에서 이 프로젝트를 통째로 뺀다 (파편까지 — 미소속으로도 안 새어나간다).
  // "여행리스트 긁으면 안 됨"(2026-07-29). 채팅·검색에는 안 건다.
  discover_skip: boolean;
  // 목록 화면용 파생값
  fragment_count?: number;
}
