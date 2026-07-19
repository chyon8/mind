-- Rudy Phase A — 하이브리드 의미 검색 RPC (RUDY-BUILD.md Phase A-1 + 타입 필터).
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-schema.sql 이후)
-- 검색은 "찾으러 온 행위" → 무덤(archived) 포함 전부 뒤진다 (Mind 기존 규칙 유지).

-- 기존 3-arg 버전이 있으면 제거 (인자 추가는 오버로드라 안 지우면 둘이 공존해 모호해진다)
drop function if exists rudy.search_fragments(text, vector, int);

create or replace function rudy.search_fragments(
  q_text      text,
  q_embed     vector(3072),
  match_count int  default 30,
  type_filter text default null       -- null = 전체, 'text'|'link'|'image'|'quote'
)
returns table (id uuid, score real, matched_by text)
language sql stable as $$
  with kw as (          -- 기존 키워드 부분일치 (정확 일치는 항상 상단 = score 1.0)
    select f.id, 1.0::real as score, 'keyword' as matched_by
    from public.fragments f
    where (f.content ilike '%'||q_text||'%' or f.link_title ilike '%'||q_text||'%')
      and (type_filter is null or f.type = type_filter)
  ),
  vec as (              -- 벡터 코사인 유사도 (정확 인덱스 없음 — 유저 1명·수천 개라 순차 스캔이 밀리초)
    select e.fragment_id as id,
           (1 - (e.embedding <=> q_embed))::real as score,
           'vector' as matched_by
    from rudy.fragment_embeddings e
    join public.fragments f on f.id = e.fragment_id
    where (type_filter is null or f.type = type_filter)
    order by e.embedding <=> q_embed
    limit match_count
  ),
  merged as (
    select id, max(score) as score, string_agg(distinct matched_by, '+') as matched_by
    from (select * from kw union all select * from vec) u
    group by id
  )
  select m.id, m.score, m.matched_by
  from merged m
  join public.fragments f on f.id = m.id
  order by m.score desc, f.created_at desc   -- 동점(키워드 1.0끼리)은 최신순 (기존 검색 정렬 보존)
  limit match_count;
$$;
