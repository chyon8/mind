-- Mind — Supabase 스키마 (PLAN.md §2)
-- Supabase 대시보드 > SQL Editor에 전체 붙여넣기 후 실행.

-- ============ 테이블 ============

create table fragments (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  content            text not null default '',
  type               text not null default 'text'
                     check (type in ('text','link','image','quote')),
  link_title         text,
  link_thumbnail_url text,
  image_path         text,
  -- 덧붙임: 파편에 나중에 붙이는 생각. 원문(content)과 분리한다 —
  -- 링크 파편은 content가 URL이라 거기에 생각을 섞으면 링크가 깨진다.
  note               text,
  last_touched_at    timestamptz not null default now(),
  tier               text not null default 'normal'
                     check (tier in ('normal','important','pinned')),
  archived           boolean not null default false,
  -- 회상: 몇 번이나 구해냈나 = 중요도. 손으로 tier를 정하지 않아도 자라난다.
  touch_count        integer not null default 0,
  -- 회상에서 흘려보낸 시각. 보여준 것만으로는 아무것도 기록하지 않는다 —
  -- 무시하면 아무 일도 안 일어나야 "안 보는 행위 자체가 판정이다"(SPEC §1)가 산다.
  let_go_at          timestamptz
);

create index fragments_created_at_idx on fragments (created_at desc);
-- 회상 후보는 "가장 오래 안 건드린 것"부터 찾는다
create index fragments_last_touched_idx on fragments (last_touched_at);

-- 프로젝트는 파편과 다른 종류의 아이템 — 타임라인에 쌓이지 않고 폴더처럼 존재한다.
create table projects (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  status      text not null default 'before'
              check (status in ('before','active','paused','done')),
  started_at  date,
  description text
);

-- 파편 ↔ 프로젝트 다대다 (태그처럼 여러 프로젝트에 동시에 붙는다)
create table fragment_projects (
  fragment_id uuid not null references fragments(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  primary key (fragment_id, project_id)
);

create index fragment_projects_project_idx on fragment_projects (project_id);

-- ============ RLS: 로그인 사용자 전부 허용 / anon 전부 차단 ============

alter table fragments enable row level security;
alter table projects enable row level security;
alter table fragment_projects enable row level security;

create policy "authenticated full access" on fragments
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on projects
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on fragment_projects
  for all to authenticated using (true) with check (true);

-- ============ Storage: images 버킷 (private) ============

insert into storage.buckets (id, name, public) values ('images', 'images', false);

create policy "authenticated read images" on storage.objects
  for select to authenticated using (bucket_id = 'images');

create policy "authenticated insert images" on storage.objects
  for insert to authenticated with check (bucket_id = 'images');

create policy "authenticated delete images" on storage.objects
  for delete to authenticated using (bucket_id = 'images');
