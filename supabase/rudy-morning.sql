-- 아침 브리핑 — 앞을 보는 카드들의 임베딩 하부 (scripts/morning/material.mjs가 부른다)
-- 일회성 배포 (이 파일이 바뀔 때만). Supabase 대시보드 > SQL Editor에 붙여넣고 실행.
-- (rudy-schema.sql 이후. `fragments.archived_at`·`note_at`이 이미 있어야 한다)
--
-- 왜 SQL인가: cluster_edges와 같은 이유다. 쌍 비교가 O(n²)이고 벡터는 3072차원이라
-- Node로 끌어오면 파편 550개에 30MB 넘는 JSON을 받게 된다. 실제로 재보고 옮겼다.
--
-- 테이블을 만들지 않는다 — 여기서 나오는 건 매번 다시 계산되는 쌍 목록뿐이다 (§2-1 규정 금지).

-- ① 돌아온 것 — 최근에 던진 것이 오래전에 던진 것과 같은 얘기인가.
--
-- 한 번 던진 건 충동이고 묻었는데 몇 주 뒤에 또 던진 건 의지다. 그 차이를 재는 유일한 방법이
-- 이거다. 최근 파편 하나당 **최근접 한 개만** 낸다 — 상위 N개를 다 내면 같은 주제가
-- 화면을 도배하고, 되돌아왔다는 사실은 짝 하나로 이미 증명된다.
--
-- ⚠️ archived·let_go를 안 거른다. 과거 짝은 **묻혀 있는 게 정상**이다(정리했으니까).
--    거르면 이 카드가 통째로 비는데, 실측(2026-08-14) 상위 12쌍의 과거 짝이 전부 묻힌 것이었다.
create or replace function rudy.revisits(
  recent_days int  default 7,     -- "최근"의 폭
  gap_days    int  default 21,    -- 이만큼 떨어진 것만 과거로 친다. 좁히면 같은 날 중복이 올라온다
  min_sim     real default 0.42,
  max_rows    int  default 12
)
returns table (recent_id uuid, past_id uuid, similarity real, gap int, past_archived boolean)
language sql stable as $$
  with recent as (
    select e.fragment_id as id, e.embedding, f.created_at
    from rudy.fragment_embeddings e
    join public.fragments f on f.id = e.fragment_id
    where f.created_at >= now() - make_interval(days => recent_days)
  ),
  past as (
    select e.fragment_id as id, e.embedding, f.created_at, f.archived
    from rudy.fragment_embeddings e
    join public.fragments f on f.id = e.fragment_id
    where f.created_at < now() - make_interval(days => gap_days)
  )
  select r.id, n.id, n.sim, n.gapd, n.archived
  from recent r
  cross join lateral (
    select past.id, past.archived,
           (1 - (r.embedding <=> past.embedding))::real as sim,
           extract(day from r.created_at - past.created_at)::int as gapd
    from past
    order by r.embedding <=> past.embedding
    limit 1
  ) n
  where n.sim >= min_sim
  order by n.sim desc
  limit max_rows;
$$;

-- ⑥ 안 이어본 연결 — 서로 다른 프로젝트에 넣어둔 것이 사실 같은 얘기인가.
--
-- 프로젝트는 유저가 손으로 나눈 칸이다. 임베딩이 그 칸을 넘어 붙는 쌍을 찾으면
-- "따로 두고 있었는데 사실 하나였던 것"이 나온다. 그게 이 카드의 전부다.
--
-- ⚠️ **시간 갭을 요구한다.** 안 걸면 상위가 전부 같은 날 두 프로젝트에 겹쳐 넣은 파편이 된다
--    (실측 2026-08-14: 1위가 유사도 0.94짜리 동일 링크였다). 그건 발견이 아니라 중복이다.
-- ⚠️ 무소속(프로젝트 없음) 파편은 빠진다 — join이 걸러낸다. "다른 칸"이 성립하지 않으니까.
create or replace function rudy.cross_project_pairs(
  min_sim      real default 0.45,
  min_gap_days int  default 14,
  max_rows     int  default 12
)
returns table (a uuid, b uuid, similarity real, gap int)
language sql stable as $$
  -- 프로젝트를 먼저 접어두고 임베딩을 붙인다. group by에 vector를 넣지 않기 위해서다 —
  -- 3072차원을 그룹 키로 쓰는 건 되더라도 할 이유가 없다.
  with proj as (
    select fragment_id, array_agg(project_id) as projects
    from public.fragment_projects
    group by fragment_id
  ),
  tagged as (
    select e.fragment_id as id, e.embedding, f.created_at, p.projects
    from rudy.fragment_embeddings e
    join public.fragments f on f.id = e.fragment_id
    join proj p on p.fragment_id = e.fragment_id
  )
  select x.id, y.id,
         (1 - (x.embedding <=> y.embedding))::real as similarity,
         abs(extract(day from x.created_at - y.created_at))::int as gap
  from tagged x
  join tagged y on x.id < y.id
  where not (x.projects && y.projects)            -- 한 프로젝트라도 겹치면 "다른 칸"이 아니다
    and abs(extract(day from x.created_at - y.created_at)) >= min_gap_days
    and (1 - (x.embedding <=> y.embedding)) >= min_sim
  order by similarity desc
  limit max_rows;
$$;

grant execute on function rudy.revisits(int, int, real, int) to service_role, authenticated;
grant execute on function rudy.cross_project_pairs(real, int, int) to service_role, authenticated;
