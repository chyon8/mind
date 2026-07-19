-- Rudy §10-4 — 원장 + 게이트 로그 (RUDY.md §5, §6-4, §6-6)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql 이후)
--
-- 원장은 §2-2 "같은 말 금지"의 물리적 실체다. 루디가 한 말을 전부 적어두고,
-- 말하기 전에 과거 발화를 확인한다. 이 테이블이 없으면 루디는 매번 처음 만난 사람처럼 군다.
--
-- ⚠️ 원장에 쓰는 것은 touch가 아니다 (§2-3). 이 경로는 public.fragments를 절대 수정하지 않는다.

create table if not exists rudy.utterances (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  surface      text not null check (surface in ('briefing','chat','recall_feed')),
  kind         text not null check (kind in
                 ('resurface','nudge','pattern','discovery','prediction','question','action_proposal')),
  medium       text check (medium in ('idea','video','book','article')),  -- 발견류 백오프의 축×매체(§6-5)
  item_ids     uuid[] not null default '{}',   -- 근거로 인용한 파편들
  text         text,        -- 생성 발화의 본문. 되살리기는 파편 자체가 발화라 null이다.
  -- 발화 임베딩 = 반복 검사(§6-4 ②)용. 생성 발화가 생길 때 채운다.
  -- 되살리기는 "같은 말"이 곧 "같은 파편"이라 item_ids로 판정하므로 여기선 null.
  embedding    vector(3072),
  -- 응답 캡처(§6-6). ignored는 저장하지 않는다 — "응답 없음 + 시간 경과"로 집계 시점에 계산한다.
  -- 노출 자체는 어떤 신호도 아니므로(§2-3) 무반응을 적극적으로 기록할 이유가 없다.
  user_response text check (user_response in ('acted','dismissed')),
  responded_at  timestamptz
);

-- 쿨다운 조회(최근 N일 안에 되살린 파편)가 주 질의다
create index if not exists utterances_created_idx on rudy.utterances (created_at desc);

-- 게이트 판정 로그 (§6-4 "모든 게이트 판정은 사유와 함께 로그 — 임계 튜닝은 감이 아니라 이 로그로").
-- 실제로 충돌 임계값을 정할 때 데이터가 없어 감으로 정해야 했다. 그 문제를 없애는 테이블이다.
create table if not exists rudy.gate_log (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  surface    text not null,
  kind       text not null,
  gate       text not null,     -- similarity | cooldown | evidence | repetition | voice | confidence | budget
  passed     boolean not null,
  reason     text,              -- 사람이 읽을 사유
  detail     jsonb              -- 숫자들 (sim, threshold, …) — 튜닝의 원료
);

create index if not exists gate_log_created_idx on rudy.gate_log (created_at desc);

-- RLS: 로그인 사용자 전체 허용 (rudy-schema.sql과 동일 정책)
alter table rudy.utterances enable row level security;
drop policy if exists "authenticated full access" on rudy.utterances;
create policy "authenticated full access" on rudy.utterances
  for all to authenticated using (true) with check (true);

alter table rudy.gate_log enable row level security;
drop policy if exists "authenticated full access" on rudy.gate_log;
create policy "authenticated full access" on rudy.gate_log
  for all to authenticated using (true) with check (true);

grant all on rudy.utterances, rudy.gate_log to service_role, authenticated;
