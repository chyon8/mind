-- Rudy §10-5 — 채팅 이력 + 자발적 연결용 벡터 충돌 RPC
-- (RUDY.md §4-C1 · §7-2, RUDY-BUILD.md C-3)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql · rudy-ledger.sql 이후)
--
-- ⚠️ 채팅은 touch가 아니다 (RUDY.md §2-3). 이 경로는 public.fragments를 읽기만 한다.

-- 대화는 하나로 길게 이어지지 않는다 — 맥락이 무한히 커지면 비용도 품질도 무너진다.
-- 유저가 "새 대화"를 누르면 새 행이 생기고, 앱은 항상 가장 최근 대화만 연다.
create table if not exists rudy.conversations (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title      text
);

create table if not exists rudy.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references rudy.conversations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  -- 근거로 인용한 파편. 앱이 답변 아래 칩으로 그리고, 탭하면 그 파편으로 간다.
  cited_ids       uuid[] not null default '{}'
);

create index if not exists messages_conv_idx on rudy.messages (conversation_id, created_at);

-- 자발적 연결(§4-C1)용. collision_candidates는 씨앗 "파편 id"를 받지만 채팅의 씨앗은
-- 방금 친 문장이라 파편이 아니다 — 벡터를 직접 받는 판이 필요하다.
-- 필터는 collision_candidates와 동일하게 유지한다 (두 표면이 같은 후보 규칙을 봐야
-- "표면 간 중복 방지"가 말이 된다). 다른 점은 씨앗이 벡터라는 것과 exclude_ids뿐.
create or replace function rudy.collision_by_embedding(
  q_embed      vector(3072),
  -- 이미 근거로 인용해 답변에 들어간 파편들. 답에 쓴 걸 "이것도 이어지는데?"라고
  -- 다시 가리키면 자발적 연결이 아니라 자기 답변 반복이다.
  exclude_ids  uuid[] default '{}',
  match_count  int default 20,
  min_age_days int default 7
)
returns table (id uuid, similarity real)
language sql stable as $$
  select e.fragment_id                              as id,
         (1 - (e.embedding <=> q_embed))::real      as similarity
  from rudy.fragment_embeddings e
  join public.fragments f on f.id = e.fragment_id
  where f.archived = false
    and not (e.fragment_id = any(exclude_ids))
    -- 아래 세 줄은 rudy-collision.sql과 같은 정의다. 바꿀 땐 양쪽 같이 바꾼다.
    and (f.let_go_at is null or f.let_go_at < now() - interval '60 days')
    and f.tier <> 'pinned'
    and f.last_touched_at < now() - make_interval(days => min_age_days)
  order by e.embedding <=> q_embed
  limit match_count;
$$;

-- RLS: 로그인 사용자 전체 허용 (rudy-schema.sql과 동일 정책)
alter table rudy.conversations enable row level security;
drop policy if exists "authenticated full access" on rudy.conversations;
create policy "authenticated full access" on rudy.conversations
  for all to authenticated using (true) with check (true);

alter table rudy.messages enable row level security;
drop policy if exists "authenticated full access" on rudy.messages;
create policy "authenticated full access" on rudy.messages
  for all to authenticated using (true) with check (true);

grant all on rudy.conversations, rudy.messages to service_role, authenticated;
