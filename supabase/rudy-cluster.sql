-- Rudy §10-6 — 클러스터 엔진의 하부 (RUDY.md §6-2 · §4-B1·B2)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql 이후)
--
-- ⚠️ 이 파일은 테이블을 만들지 않는다. 클러스터는 휘발성이다 (§2-1 규정 금지) —
--    `rudy.clusters` 같은 영속 테이블을 만드는 순간 "이 사람은 이런 사람"을 DB에 적는 셈이다.
--    여기서 나오는 건 **엣지 목록**(어느 파편과 어느 파편이 얼마나 가까운가)뿐이고,
--    묶기·이름 붙이기는 실행 시점에 하고 버린다.
--
-- 왜 SQL에서 도는가: 쌍 비교는 O(n²)인데 벡터는 3072차원이다. Deno로 끌어오면
-- 파편 500개에 수십 MB를 전송하게 된다. 벡터가 있는 자리에서 돌리고 숫자만 가져온다.
--
-- ⚠️ **명시적 Mind 프로젝트에 묶인 파편은 뺀다** (2026-07-20 수정).
-- §4-B2가 "Mind의 명시적 프로젝트 + 프로젝트로 안 묶였지만 뭉치는 암묵 클러스터"라고
-- 둘을 나눠놨는데 처음 구현이 이 구분을 놓쳤다. Caselab(위시켓 업무 프로젝트)처럼
-- 유저가 이미 이름 붙인 프로젝트의 파편까지 섞어 돌리니, 하루에 몰아 저장한 업무 메모가
-- 매번 최상위 축으로 나와서 "네가 이미 아는 걸 발견이라고 다시 이름 붙이는" 꼴이 됐다.
-- 클러스터의 가치는 **아직 안 묶인 것**을 묶는 데 있다 — 이미 조직된 건 재료가 아니다.

create or replace function rudy.cluster_edges(
  days      int  default 90,          -- 창 (§6-2: 최근 90일 items)
  min_sim   real default 0.40,        -- 이 아래 쌍은 아예 안 보낸다 (잠정 — 실측으로 정한다)
  max_edges int  default 4000
)
returns table (a uuid, b uuid, similarity real)
language sql stable as $$
  with pool as (
    select e.fragment_id as id, e.embedding
    from rudy.fragment_embeddings e
    join public.fragments f on f.id = e.fragment_id
    where f.archived = false                      -- 무덤은 "요즘의 축"이 아니다
      and f.created_at >= now() - make_interval(days => days)
      -- 이미 명시적 프로젝트에 묶인 파편은 암묵 클러스터의 재료가 아니다 (위 설명 참고)
      and not exists (
        select 1 from public.fragment_projects fp where fp.fragment_id = e.fragment_id
      )
    -- 흘려보낸 것(let_go_at)도 뺀다? 안 뺀다. 흘려보내기는 "회상 거절"이지 저장 취소가 아니고,
    -- 그때 저장했다는 사실 자체가 그 시기 관심의 증거다. 충돌 엔진과 목적이 다르다
    -- (거긴 다시 보여줄 것을 고르는 자리라 쿨다운이 필요했다).
    -- pinned도 뺀다? 안 뺀다. 고정은 흐려지지 않을 뿐, 가장 강한 증거다.
  )
  select p1.id, p2.id, (1 - (p1.embedding <=> p2.embedding))::real as similarity
  from pool p1
  join pool p2 on p1.id < p2.id                   -- 각 쌍 한 번만 (무향 그래프)
  where (1 - (p1.embedding <=> p2.embedding)) >= min_sim
  order by similarity desc
  limit max_edges;
$$;
