-- Rudy 비용 추적 (2026-07-22) — "어제 왜 4.93달러 나갔지"에 답을 못 한 것에서 시작.
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql 이후) — 일회성 배포.

-- 호출 하나하나의 원장. gate_log와 같은 결 — 실패해도 본 기능(채팅·발견)을 안 막는다.
create table if not exists rudy.llm_usage (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  call_site         text not null,   -- 'chat.rewrite' | 'chat.answer' | 'chat.axis_label' |
                                      -- 'chat.question_judge' | 'discovery.angles' | 'discovery.assemble'
  model             text not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  cached_tokens     integer not null default 0,
  cost_usd          numeric(10,6),   -- 단가를 모르는 모델이면 null (0으로 속이지 않는다)
  request_id        uuid not null,   -- 채팅 1턴 / 브리핑 1회를 묶는 키 — 응답당 합산에 쓴다
  conversation_id   uuid
);
create index if not exists llm_usage_created_idx on rudy.llm_usage (created_at desc);
create index if not exists llm_usage_request_idx on rudy.llm_usage (request_id);

-- RLS: 로그인 사용자 전체 허용 (rudy-schema.sql·rudy-ledger.sql과 동일 정책)
alter table rudy.llm_usage enable row level security;
drop policy if exists "authenticated full access" on rudy.llm_usage;
create policy "authenticated full access" on rudy.llm_usage
  for all to authenticated using (true) with check (true);

grant all on rudy.llm_usage to service_role, authenticated;

-- 응답 하나의 총 비용 — 모바일에서 그 응답 바로 아래에 보이게 결과 행에 박아둔다.
alter table rudy.messages add column if not exists cost_usd numeric(10,6);
alter table rudy.utterances add column if not exists cost_usd numeric(10,6);

-- 확인: select call_site, count(*), sum(cost_usd) from rudy.llm_usage
--       where created_at >= now() - interval '1 day' group by call_site order by 3 desc nulls last;
