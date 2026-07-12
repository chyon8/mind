// PLAN.md §2.1 스키마와 1:1 대응
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
  project_id: string | null;
  archived: boolean;
}

export interface Project {
  id: string;
  created_at: string;
  name: string;
  status: ProjectStatus;
}
