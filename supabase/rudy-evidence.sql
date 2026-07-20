-- Rudy §10-6+ — 늦은 의도(F1)가 받아낸 유저의 자기 진술 (RUDY.md §5 · §4-F1 · §4-B2)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-ledger.sql 이후)
--
-- ⚠️ 이 테이블이 §2-1의 경계선이다. 루디의 추론은 어디에도 저장하지 않지만
--    **유저가 직접 말한 것은 저장한다.** "이 사람은 케이스랩에 빠져 있다"(루디의 결론) ❌ /
--    "케이스랩 준비하고 있어"(유저의 말) ✅. 앞은 규정이고 뒤는 사실이다.
--
-- ⚠️ stated_text에는 **유저가 쓴 문장을 그대로** 넣는다. 요약·정규화하지 않는다 —
--    모델이 다듬는 순간 그건 유저의 진술이 아니라 루디의 해석이고, 위 경계선을 넘은 것이다.

create table if not exists rudy.evidence (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  stated_text      text not null,                  -- 유저의 말 그대로
  related_item_ids uuid[] not null default '{}',   -- 이 진술이 설명하는 파편들
  -- 나중에 "이 말 전에도 했나"(§6-4 ②)와 의미 검색에 쓴다. 지금 소비처는 파편 id 겹침 조회뿐이라
  -- 안 써도 되지만, 채워두지 않으면 나중에 백필을 또 돌려야 한다 (임베딩 백필 두 번 해봤다).
  embedding        vector(3072),
  -- 어느 질문에 대한 답이었나. 질문이 지워져도 진술은 남는다 (진술이 본체다).
  utterance_id     uuid references rudy.utterances(id) on delete set null
);

-- 주 질의: "이 축의 파편들에 대해 유저가 직접 말한 게 있나" (배열 겹침)
create index if not exists evidence_items_idx on rudy.evidence using gin (related_item_ids);
create index if not exists evidence_created_idx on rudy.evidence (created_at desc);

-- RLS: 로그인 사용자 전체 허용 (rudy-schema.sql과 동일 정책)
alter table rudy.evidence enable row level security;
drop policy if exists "authenticated full access" on rudy.evidence;
create policy "authenticated full access" on rudy.evidence
  for all to authenticated using (true) with check (true);

grant all on rudy.evidence to service_role, authenticated;
