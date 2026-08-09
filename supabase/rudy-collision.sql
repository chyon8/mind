-- Rudy Phase B — 충돌 회상 (RUDY.md §4-A1 · §10-3, RUDY-BUILD.md Phase B-1)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql 이후)
--
-- RUDY-BUILD B-1의 "seed 평균 임베딩"에서 바꿨다:
--   (1) 무관한 걸 여러 개 던진 날 평균 벡터는 어느 축도 아닌 노이즈 중심이 된다.
--       그 중심에 가까운 파편 = 아무 주제에도 안 닿은 파편 → 억지 충돌(§2-8 위반).
--   (2) "왜 지금"(B-3)은 어느 파편과 부딪혔는지를 요구한다. 평균은 그 정보를 지운다.
-- → seed마다 개별 비교하고 후보별 최댓값 + 그때의 seed를 함께 반환한다.

-- min_age_days를 붙이기 전의 2인자 판이 DB에 남아 있었다. create or replace는 인자 목록이
-- 다르면 교체가 아니라 **오버로드 추가**라, 앱이 seed_ids 하나만 넘기는 순간 PostgREST가
-- "Could not choose the best candidate function"으로 거절했다 — 충돌 회상이 조용히 죽고
-- 매번 랜덤으로 폴백하고 있었다(2026-08-09 실측). 옛 판을 먼저 지운다.
drop function if exists rudy.collision_candidates(uuid[], int);

create or replace function rudy.collision_candidates(
  seed_ids      uuid[],               -- 최근 던진 파편들 (각각이 씨앗)
  match_count   int default 40,
  -- 아래 사전 컷의 일수. 진단 스크립트가 0을 넣어 감쇠 필터를 끄고 유사도 분포를 본다
  -- (코퍼스가 어리면 후보가 전부 걸러져 벡터 계산 자체를 검증할 수 없다).
  min_age_days  int default 7
)
returns table (id uuid, similarity real, seed_id uuid)
language sql stable as $$
  select * from (
    -- 후보 × seed 전수 비교 후 후보별 최근접 seed 하나만 남긴다.
    -- 유저 1명·수천 파편 × seed 몇 개 → 순차 스캔으로 충분 (search_fragments와 같은 판단).
    select distinct on (e.fragment_id)
           e.fragment_id                              as id,
           (1 - (e.embedding <=> s.embedding))::real  as similarity,
           s.fragment_id                              as seed_id
    from rudy.fragment_embeddings e
    join public.fragments f on f.id = e.fragment_id
    cross join (
      select fragment_id, embedding
      from rudy.fragment_embeddings
      where fragment_id = any(seed_ids)
    ) s
    where f.archived = false
      and not (e.fragment_id = any(seed_ids))         -- 씨앗 자신 제외
      -- 흘려보낸 것의 쿨다운 7일 (supabase.ts fetchRecallPool과 같은 정의)
      and (f.let_go_at is null or f.let_go_at < now() - interval '7 days')
      -- 고정된 파편은 흐려지지 않는다 = 회상 후보가 될 수 없다 (vividness.ts: pinned → 1)
      and f.tier <> 'pinned'
      -- ⚠️ 선명도 자체는 계산하지 않는다 (SPEC §5: 저장 안 함, 판정은 화면에서).
      --    여기선 "아직 흐려졌을 리 없는 것"만 보수적으로 걷어낸다 — 감쇠가 가장 빠른
      --    normal tier도 7.4일은 지나야 NEAR_FLOOR(0.7) 아래로 간다. 유효 후보를 자를 일이 없다.
      --    진짜 판정은 recall.ts stillFading이 한다 (감쇠 법칙의 단일 원천 = vividness.ts).
      and f.last_touched_at < now() - make_interval(days => min_age_days)
    order by e.fragment_id, e.embedding <=> s.embedding
  ) best
  order by best.similarity desc
  limit match_count;
$$;
