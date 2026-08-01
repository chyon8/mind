-- 프로젝트 상태가 **언제** 바뀌었나 — Supabase 대시보드 > SQL Editor에 붙여넣고 실행.
--
-- 왜 필요한가 (2026-08-01 실측):
--   Caselab이 이전 3주에 파편 26개를 받다가 최근 7일에 0개다. 아침 브리핑이 그걸 "완전히
--   멈췄다"고 읽었는데 **틀렸다 — 완료(done)한 거다.** 상태를 안 보고 숫자만 보면 침묵과
--   종료가 똑같이 0으로 보인다.
--   그런데 `projects`에는 `created_at`·`started_at`만 있고 **상태가 바뀐 시각이 없어서**,
--   "이번 주에 끝냈다"를 DB에서 원리상 못 꺼냈다. 이 컬럼이 그걸 연다.
--
-- ⚠️ **기존 행은 NULL로 둔다. 백필하지 마라.**
--    Caselab이 언제 done이 됐는지 아무도 모른다. `created_at`으로 채우면 그 거짓 날짜를
--    다음 세션이 사실로 읽는다. NULL = "모름"이 정직하다. 오늘 이후 바뀌는 것부터 쌓인다.
--
-- 쓰는 쪽: `src/lib/supabase.ts updateProject()` (status가 패치에 있으면 같이 찍는다) ·
--          `scripts/morning/material.mjs` (이번 주에 바뀐 것만 ★로 표시).
--          ⚠️ material.mjs는 `select('*')`라 이 SQL을 안 붙여도 안 죽는다 — 표시만 안 뜬다.

alter table public.projects
  add column if not exists status_changed_at timestamptz;
