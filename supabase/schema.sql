-- Mind — Supabase 스키마 (PLAN.md §2)
-- Supabase 대시보드 > SQL Editor에 전체 붙여넣기 후 실행.

-- ============ 테이블 ============

create table projects (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  status     text not null default 'before'
             check (status in ('before','active','paused','done'))
);

create table fragments (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  content            text not null default '',
  type               text not null default 'text'
                     check (type in ('text','link','image','quote')),
  link_title         text,
  link_thumbnail_url text,
  image_path         text,
  last_touched_at    timestamptz not null default now(),
  tier               text not null default 'normal'
                     check (tier in ('normal','important','pinned')),
  project_id         uuid references projects(id) on delete set null,
  archived           boolean not null default false
);

create index fragments_created_at_idx on fragments (created_at desc);

-- ============ RLS: 로그인 사용자 전부 허용 / anon 전부 차단 ============

alter table projects enable row level security;
alter table fragments enable row level security;

create policy "authenticated full access" on projects
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on fragments
  for all to authenticated using (true) with check (true);

-- ============ Storage: images 버킷 (private) ============

insert into storage.buckets (id, name, public) values ('images', 'images', false);

create policy "authenticated read images" on storage.objects
  for select to authenticated using (bucket_id = 'images');

create policy "authenticated insert images" on storage.objects
  for insert to authenticated with check (bucket_id = 'images');

create policy "authenticated delete images" on storage.objects
  for delete to authenticated using (bucket_id = 'images');
