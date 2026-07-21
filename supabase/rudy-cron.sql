-- Rudy §10-8 — 아침 브리핑 스케줄 (RUDY.md §7-3)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-push.sql, morning-briefing 함수 배포 이후)
--
-- pg_cron이 매일 정해진 시각에 morning-briefing 함수를 호출한다. 함수 안에서 하루 1회 상한·
-- 빈 브리핑 스킵을 다시 확인하므로(§2-8) cron이 중복 실행돼도 안전하다.
--
-- ⚠️ 이 파일을 SQL Editor에 붙여넣기 전에 아래 두 자리를 채워라:
--   1. <SERVICE_ROLE_KEY> — Supabase 대시보드 > Settings > API의 service_role 키.
--      cron job은 Deno 시크릿을 못 읽으므로 여기 직접 넣는다. **채운 뒤의 파일을 그대로 커밋하지 마라**
--      (git에 키가 남는다) — SQL Editor에만 붙여넣고, 저장소엔 이 플레이스홀더 버전을 유지할 것.
--   2. 시각 — 지금은 08:00 KST(=23:00 UTC 전날)로 잡았다. 바꾸려면 cron 표현식만 수정.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'rudy-morning-briefing',
  '0 23 * * *',  -- 23:00 UTC = 08:00 KST (다음날)
  $$
  select net.http_post(
    url := 'https://ibqyqpmwqujcxlnkyizf.supabase.co/functions/v1/morning-briefing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 확인: select * from cron.job where jobname = 'rudy-morning-briefing';
-- 지우려면: select cron.unschedule('rudy-morning-briefing');
