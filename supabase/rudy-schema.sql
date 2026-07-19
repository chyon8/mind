-- Rudy — rudy 스키마 (RUDY-BUILD.md Phase 0)
-- Supabase 대시보드 > SQL Editor에 전체 붙여넣기 후 실행.
-- public.fragments는 읽기만 한다 — Mind 데이터 무오염 (RUDY.md §2, RUDY-BUILD.md 0).

create schema if not exists rudy;
create extension if not exists vector;      -- pgvector

-- 파편 임베딩. fragment와 1:1. 파편 삭제 시 cascade.
create table if not exists rudy.fragment_embeddings (
  fragment_id  uuid primary key
               references public.fragments(id) on delete cascade,
  embedding    vector(3072) not null,       -- text-embedding-3-large
  -- 임베딩 원천 텍스트(embed_text)의 해시. 내용이 안 바뀌었으면 재임베딩 스킵.
  -- touch·touch_count 등 embed_text와 무관한 컬럼 변경엔 update 웹훅이 와도 스킵된다.
  source_hash  text not null,
  embedded_at  timestamptz not null default now()
);

-- RLS: 로그인 사용자 전체 허용 (Mind와 동일 정책)
alter table rudy.fragment_embeddings enable row level security;
drop policy if exists "authenticated full access" on rudy.fragment_embeddings;
create policy "authenticated full access" on rudy.fragment_embeddings
  for all to authenticated using (true) with check (true);

-- Edge Function(service role) + 앱(authenticated)이 rudy 스키마에 접근할 수 있게
grant usage on schema rudy to service_role, authenticated;
grant all on all tables in schema rudy to service_role, authenticated;
-- 이후 만들 함수(RPC) 실행권도 미리
grant execute on all functions in schema rudy to service_role, authenticated;
alter default privileges in schema rudy
  grant execute on functions to service_role, authenticated;

-- ⚠️ 대시보드 > Settings > API > "Exposed schemas"에 rudy 추가해야
--    PostgREST/RPC(supabase-js .schema('rudy'))로 접근된다.
