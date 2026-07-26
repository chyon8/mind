-- "다음 발견에 포함" 표시 (RUDY-STATUS.md 확정 계획 ①, 2026-07-25)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. **일회성 배포** (코드 바뀔 때만).
--
-- 유저가 파편을 보다가 "이건 다음 브리핑에서 다뤄줘"를 누르면 여기 true가 된다.
-- 브리핑이 한 번 돌면 전부 false로 내려간다 — 한 번 나오고 끝(또 원하면 또 누른다).
--
-- ⚠️ 이 플래그는 선명도를 건드리지 않는다. last_touched_at·touch_count를 안 만지므로
--    "그냥 봤다고 선명해지면 안 된다"(SPEC §1 · RUDY.md §2-3)는 그대로 지켜진다.
--    embed 웹훅이 이 UPDATE로 깨어나지만 source_hash가 같아 재임베딩은 스킵된다.

alter table fragments
  add column if not exists discover_next boolean not null default false;

-- 브리핑이 매번 "표시된 것"만 골라 읽는다 — 부분 인덱스로 true인 행만 담는다.
create index if not exists fragments_discover_next_idx
  on fragments (discover_next) where discover_next;
