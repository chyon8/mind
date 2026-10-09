-- 연관 파편을 따로 누르지 않아도 보이게 하는 두 함수 (2026-10-09).
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql 이후)
--
-- 임계 0.5: 실측(2026-10-09, 파편 79개 표본 × similar_fragments 상위 8)에서
--   0.5 이상은 눈으로 봐도 거의 다 관련 있었고, 0.42~0.5는 섞여 있었다.
--   0.5에서 파편당 평균 1.4개, 39%는 0개. 앱(supabase.ts RELATED_MIN_SIM)과 같은 값.
-- 연결은 저장하지 않는다(Mind SPEC §7) — 화면에 그릴 때마다 계산한다.

-- 파편마다 "비슷한 것 n개". 행 옆 숫자용.
-- similar_fragments와 같은 규칙 — 무덤도 센다. 숫자를 눌러 들어간 상세에서 무덤까지 나오므로
-- 여기서 빼면 숫자와 목록이 어긋난다.
create or replace function rudy.similar_counts(
  ids     uuid[],
  min_sim real default 0.5
)
returns table (id uuid, n int)
language sql stable as $$
  select s.fragment_id     as id,
         count(e.fragment_id)::int as n
  from rudy.fragment_embeddings s
  left join rudy.fragment_embeddings e
    on e.fragment_id <> s.fragment_id
   and 1 - (e.embedding <=> s.embedding) >= min_sim
  where s.fragment_id = any(ids)
  group by s.fragment_id;
$$;

-- 그 날 던진 파편들과 닿는 그 이전 파편. 데일리 뷰 아래 "이 날과 닿은 옛 파편"용.
-- 사람이 찾으러 온 자리가 아니라 먼저 보여주는 자리라 무덤은 뺀다.
-- collision_candidates처럼 씨앗마다 따로 비교하고 후보별 최근접 씨앗 하나만 남긴다.
create or replace function rudy.related_to_day(
  seed_ids    uuid[],
  before      timestamptz,          -- 그 날 0시. 이보다 먼저 만든 것만
  min_sim     real default 0.5,
  match_count int  default 5
)
returns table (id uuid, similarity real, seed_id uuid)
language sql stable as $$
  select * from (
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
      and f.created_at < before
      and 1 - (e.embedding <=> s.embedding) >= min_sim
    order by e.fragment_id, e.embedding <=> s.embedding
  ) best
  order by best.similarity desc
  limit match_count;
$$;
