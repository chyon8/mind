-- 무리 (헤매기 안) — 살아있는 파편끼리의 유사도 엣지.
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql 이후)
--
-- rudy.cluster_edges와 왜 따로 두는가: 저건 **아직 안 묶인 것**을 찾는 자리라
-- 프로젝트에 붙은 파편을 통째로 뺀다. 무리는 반대다 — 지금 살아있는 것 전부를 놓고
-- 뭐가 뭐랑 붙는지 보는 자리라 프로젝트 소속 여부를 안 본다. 한 함수에 플래그를 붙여
-- 두 용도를 겸하게 하면 다음에 한쪽을 고칠 때 다른 쪽이 조용히 바뀐다.
--
-- ⚠️ 묻힌 것(archived)만 뺀다. 무리는 "지금 안 묶인 게 뭔가"를 보는 자리라 이미 정리된 걸
--    섞으면 방금 던진 것과 처리 끝난 게 한 무리에 묶인다.
--
-- ⚠️ 흘려보낸 것(let_go_at)은 **안 뺀다.** 2026-08-16까지 뺐었는데 근거가 없었다 —
--    묻기용 논리를 복붙한 자리다. 흘려보내기는 "지금 회상으로 다시 보긴 싫다"이지 저장 취소가
--    아니고(rudy-cluster.sql 각주와 같은 이유), 무리는 회상이 아니라 훑어보는 자리라 쿨다운도
--    필요 없다. 실측(2026-08-16): 빼면 대상 54개인데 안 빼면 85개 — **31개가 통째로 사라지고
--    있었다.** 안 빼도 약한 무리(최저쌍<0.28)는 0개 그대로고 커버는 69%→75%로 올라간다.
--    회상 쪽(fetchRecallPool·rudy-collision·rudy-chat)의 7일 쿨다운과는 무관하다.
--
-- 여기서 나오는 건 엣지 목록뿐이고 묶기는 Edge Function이 평균연결로 한다 — 무리는
-- 저장하지 않는다 (§2-1 규정 금지, cluster_edges와 같은 원칙).

create or replace function rudy.group_edges(
  min_sim   real default 0.33,
  max_edges int  default 20000
)
returns table (a uuid, b uuid, similarity real)
language sql stable as $$
  with pool as (
    select e.fragment_id as id, e.embedding
    from rudy.fragment_embeddings e
    join public.fragments f on f.id = e.fragment_id
    where f.archived = false
  )
  select p1.id, p2.id, (1 - (p1.embedding <=> p2.embedding))::real as similarity
  from pool p1
  join pool p2 on p1.id < p2.id
  where (1 - (p1.embedding <=> p2.embedding)) >= min_sim
  order by similarity desc
  limit max_edges;
$$;
