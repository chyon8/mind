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
  last_touched_at: string;
  tier: Tier;
  archived: boolean;
  // fragment_projects에서 파생 (클라이언트 전용). 빈 배열 = Inbox
  project_ids: string[];
}

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
