// PLAN.md §2.1 스키마와 대응
export type FragmentType = 'text' | 'link' | 'image' | 'quote';
export type Tier = 'normal' | 'important' | 'pinned';
export type ProjectStatus = 'before' | 'active' | 'paused' | 'done';

export interface Fragment {
  id: string;
  created_at: string;
  content: string;
  type: FragmentType;
  link_title: string | null;
  link_thumbnail_url: string | null;
  image_path: string | null;
  note: string | null; // 덧붙임 — 나중에 붙이는 생각. 상세 화면에서만 편집
  last_touched_at: string;
  tier: Tier;
  archived: boolean;
  touch_count: number; // 회상에서 구해낸 횟수 = 자라나는 중요도
  let_go_at: string | null; // 회상에서 흘려보낸 시각. 보여준 것만으론 기록되지 않는다
  // fragment_projects에서 파생 (클라이언트 전용). 빈 배열 = Inbox
  project_ids: string[];
}

// 캘린더에 점만 찍으면 되는 최소 정보. 날짜별 밀도를 알려고 파편 전체를 들고 올 이유가 없다.
export type DayMark = Pick<
  Fragment,
  'id' | 'created_at' | 'last_touched_at' | 'tier' | 'touch_count'
>;

export interface Project {
  id: string;
  created_at: string;
  name: string;
  status: ProjectStatus;
  started_at: string | null; // YYYY-MM-DD
  description: string | null;
  // 목록 화면용 파생값
  fragment_count?: number;
}
