-- "발견에서 제외" 표시 (2026-07-29 유저 요청: "발견에서 긁을때 제외하게 버튼
-- 프로젝트별 그리고 파편별. 예를들면 여행리스트 긁으면 안됨").
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. **일회성 배포** (코드 바뀔 때만).
--
-- discover_next(포함)의 대칭이다. 지금까지 재료에서 빠지는 길은 status='done' 하나뿐이라
-- 여행리스트 같은 건 `lists` 구획으로 그대로 들어갔고, lists는 "절반 이상을 여기서 뽑아라"의
-- 대상이라 오히려 **우대받는 자리**였다 (material.ts).
--
-- 범위: **발견에만 건다.** 채팅·검색은 그대로 다 본다 (유저 결정 2026-07-29) —
-- "여행리스트 뭐 있지"에 답할 수 있어야 하니까.
--
-- ⚠️ 이 플래그도 선명도를 건드리지 않는다. last_touched_at·touch_count를 안 만지므로
--    "그냥 봤다고 선명해지면 안 된다"(SPEC §1 · RUDY.md §2-3)는 그대로 지켜진다.

alter table projects
  add column if not exists discover_skip boolean not null default false;

alter table fragments
  add column if not exists discover_skip boolean not null default false;

-- 재료 로더가 매번 "제외된 것"을 걸러 읽는다 — 부분 인덱스로 true인 행만 담는다.
create index if not exists fragments_discover_skip_idx
  on fragments (discover_skip) where discover_skip;
