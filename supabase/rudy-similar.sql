-- 파편 하나와 뜻이 닿는 다른 파편들 (파편 상세의 "이거 관련 뭐 있었지").
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql 이후)
--
-- ⚠️ rudy.collision_candidates와 쌍둥이지만 **회상 필터를 전부 뺐다** — archived·let_go_at·
--    tier·last_touched_at 어느 것도 안 본다. 저기는 "루디가 먼저 꺼낼 만한가"를 묻는 자리라
--    감쇠 조건이 붙지만, 여기는 사람이 직접 눌러 찾으러 온 자리다.
--    검색은 찾으러 온 행위 → 무덤도 뒤진다 (rudy-search.sql:3과 같은 규칙).
--    한 함수에 두 규칙을 섞지 마라 — 섞는 순간 어느 쪽도 자기 규칙대로 못 돈다.
--
-- 임계도 안 건다: 상위 몇 개를 주는 건 검색의 일이고, 억지 충돌을 막는 게이트(§2-8)는
-- 루디가 **먼저 말할 때** 필요한 것이지 사람이 물었을 때 필요한 게 아니다.

create or replace function rudy.similar_fragments(
  source_id   uuid,
  match_count int default 8
)
returns table (id uuid, similarity real)
language sql stable as $$
  select e.fragment_id                              as id,
         (1 - (e.embedding <=> s.embedding))::real  as similarity
  from rudy.fragment_embeddings e
  cross join (
    select embedding from rudy.fragment_embeddings where fragment_id = source_id
  ) s
  where e.fragment_id <> source_id
  order by e.embedding <=> s.embedding
  limit match_count;
$$;
