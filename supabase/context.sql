-- 맥락 (2026-08-14) — 파편·발견·임베딩과 **완전히 독립된 공간**.
-- 내가 직접 써 넣는 나에 대한 사실: 진행한 프로젝트, 직업, 커리어, 좋아하는 것.
-- 쓰임 = 다른 LLM 대화창에 붙여넣을 맥락을 요청에 맞게 요약해서 꺼내는 것.
--
-- ⚠️ fragments를 읽지 않고 임베딩도 만들지 않는다. 검색도 안 한다 —
--    카드가 수십 개 규모라 **전량을 그대로 모델에 넘기는 게** 제일 단순하고 정확하다.
--    수백 개로 자라면 그때 다시 본다.
-- ⚠️ public.projects와 잇지 않는다. 이름이 겹쳐도 용도가 다르다(저 쪽은 파편의 렌즈).
--
-- 일회성 배포 (이 파일이 바뀔 때만). Supabase 대시보드 > SQL Editor에 붙여넣고 실행.

create table if not exists public.context_cards (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 요약할 때 모델이 "이 요청에 이 카드가 필요한가"를 제목으로 판단한다.
  -- 본문 형식은 자유지만 제목은 잘 써야 한다 (`프로젝트/Mind`, `커리어/OOO 2021-2023`).
  title      text not null default '',
  body       text not null default ''
);

-- 목록은 만든 순 고정 — 처음 채워 넣은 순서가 곧 배치다. 수동 정렬 컬럼은 두지 않는다.
create index if not exists context_cards_created_idx on public.context_cards (created_at);

-- RLS: 로그인 사용자 전체 허용 (schema.sql과 동일 정책)
alter table public.context_cards enable row level security;
drop policy if exists "authenticated full access" on public.context_cards;
create policy "authenticated full access" on public.context_cards
  for all to authenticated using (true) with check (true);
