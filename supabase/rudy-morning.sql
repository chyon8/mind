-- 아침 브리핑의 축 (RUDY.md §4-F4) — Supabase 대시보드 > SQL Editor에 붙여넣고 실행.
--
-- `rudy.cluster_edges`의 **쌍둥이인데 프로젝트 제외만 뺀다.** 한 함수에 두 규칙을 섞지 않는다
-- (rudy-similar.sql이 collision_candidates에 대해 한 것과 같은 처리).
--
-- 왜 갈라야 하나: cluster_edges가 프로젝트 소속 파편을 빼는 건 **발견/암묵 클러스터의 규칙**이다.
-- "이미 유저가 이름 붙여 조직한 건 발견의 재료가 아니다"(rudy-cluster.sql:12-17). 맞는 규칙이다.
-- 그런데 아침 관찰이 답하는 질문은 **"내가 요즘 어떤가"**라서 정반대다 — 유저가 프로젝트에
-- 붙여둔 파편이야말로 지금 뭘 하고 있는지의 핵심 증거다. 빼면 아무것도 안 남는다.
--
-- 실측 (2026-08-01, 살아있는 파편 74개):
--   cluster_edges(제외 있음): 0.42에서 엣지 2개·노드 4개 → **축 0개.** 아침 화면이 통째로 빈다.
--   morning_edges(제외 없음): 0.42에서 엣지 32개 → **축 3개** (AI 보이스 도구 / 채팅 개선 / Caselab).
-- 임계는 채팅과 같은 0.42를 쓴다 (chat/clusters.ts MIN_SIM). 새 숫자를 만들지 않는다.

create or replace function rudy.morning_edges(
  days      int  default 90,
  min_sim   real default 0.40,
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
    -- ⚠️ cluster_edges에 있는 fragment_projects 제외가 **여기엔 없다.** 그게 이 함수의 전부다.
    -- let_go_at·pinned를 안 빼는 이유는 cluster_edges와 같다 (rudy-cluster.sql:36-39).
  )
  select p1.id, p2.id, (1 - (p1.embedding <=> p2.embedding))::real as similarity
  from pool p1
  join pool p2 on p1.id < p2.id
  where (1 - (p1.embedding <=> p2.embedding)) >= min_sim
  order by similarity desc
  limit max_edges;
$$;
