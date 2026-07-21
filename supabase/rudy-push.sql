-- Rudy §10-8 — 푸시 토큰 + 브리핑 트리거 구분 (RUDY.md §4-F4 · §7-3)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-ledger.sql 이후)
--
-- 유저 1명이지만 기기·재설치마다 토큰이 바뀔 수 있어 여러 개를 들고 있는다(만료된 건 발송 실패 시 지운다).
-- 이 테이블은 알림 발송 대상일 뿐 — 유저에 대한 결론이 아니므로 §2-1과 무관하다.

create table if not exists rudy.push_tokens (
  token      text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table rudy.push_tokens enable row level security;
drop policy if exists "authenticated full access" on rudy.push_tokens;
create policy "authenticated full access" on rudy.push_tokens
  for all to authenticated using (true) with check (true);

grant all on rudy.push_tokens to service_role, authenticated;

-- 원장에 "누가 이 발화를 트리거했나"를 남긴다. 유저 요청(2026-07-21) — 발견 화면 기록 목록에서
-- "직접 만든 발견"과 "아침 푸시가 만든 것"을 구분해서 보여주려면 이 태그가 필요하다.
alter table rudy.utterances
  add column if not exists trigger text not null default 'pull' check (trigger in ('pull','push'));

comment on column rudy.utterances.trigger is
  'pull = 유저가 화면에서 직접 생성 / push = 아침 푸시 배치가 생성. 표시 구분용, 판정 로직과 무관.';
