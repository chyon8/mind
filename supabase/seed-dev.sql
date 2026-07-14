-- 개발용 — Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행.
-- 1) 회상 컬럼 마이그레이션  2) 회상/캘린더/무한스크롤을 실제로 볼 수 있는 테스트 파편
-- 테스트가 끝나면 맨 아래 정리 쿼리로 지울 수 있다.

-- ============ 1. 마이그레이션 (한 번만) ============

alter table fragments
  add column if not exists touch_count integer not null default 0,
  add column if not exists let_go_at   timestamptz;

create index if not exists fragments_last_touched_idx on fragments (last_touched_at);

-- ============ 2. 테스트 파편 ============
-- created_at = 언제 던졌나 (캘린더 점이 찍히는 날)
-- last_touched_at = 마지막으로 건드린 때 (선명도를 정하는 유일한 값)
-- 둘을 일부러 어긋나게 둔 행들이 있다 — 그게 회상이 존재하는 이유다.

insert into fragments (content, type, created_at, last_touched_at, tier, touch_count, let_go_at) values

-- ── 잊히기 직전. 회상 후보 (선명도 0.5 이하) ─────────────────────────
('기억은 저장이 아니라 재구성이다. 떠올릴 때마다 조금씩 다시 쓰인다.',
 'text', now() - interval '52 days', now() - interval '52 days', 'normal', 0, null),

('https://www.are.na/about',
 'link', now() - interval '78 days', now() - interval '78 days', 'normal', 0, null),

('"우리는 우리가 반복하는 것이다."',
 'quote', now() - interval '41 days', now() - interval '41 days', 'normal', 0, null),

('앱을 하나 만들되, 기능을 늘리지 말고 오해를 줄이는 방향으로.',
 'text', now() - interval '95 days', now() - interval '95 days', 'normal', 0, null),

-- 중요 표시된 채 오래 방치됨 → 후보 중에서도 뽑힐 확률이 높다 (가중치 +2)
('이사 갈 동네 후보: 연희동, 망원, 서교. 조건은 딱 하나 — 걸어서 갈 산.',
 'text', now() - interval '120 days', now() - interval '110 days', 'important', 0, null),

-- ── 이미 두 번 구해낸 것 → normal인데도 important 곡선을 타서 아직 살아있다.
--    후보에 안 뜨는 게 정상이다 (자라난 중요도가 작동하는 증거).
('평생 정리를 하지 않는 사람을 위한 도구. 정리를 요구하는 앱은 반드시 죽는다.',
 'text', now() - interval '140 days', now() - interval '40 days', 'normal', 2, null),

-- ── pinned → 절대 안 흐려지고 회상에도 안 뜬다
('던진 순간 선명하고, 시간이 지나면 흐려지고, 건드리면 다시 선명해진다.',
 'text', now() - interval '160 days', now() - interval '160 days', 'pinned', 0, null),

-- ── 이미 흘려보낸 것 → 60일 쿨다운이라 회상 후보에서 빠진다
('나중에 읽을 것: 광고 카피 잘 쓰는 법 (별로였음)',
 'text', now() - interval '88 days', now() - interval '88 days', 'normal', 0, now() - interval '5 days'),

-- ── 캘린더에 지층이 보이도록 흩뿌리는 것들 (중간 나이) ─────────────
('회의 중 떠오름: 검색은 결국 기억의 실패를 보완하는 도구다.',
 'text', now() - interval '12 days', now() - interval '12 days', 'normal', 0, null),
('https://ciechanow.ski/lights-and-shadows/',
 'link', now() - interval '19 days', now() - interval '19 days', 'normal', 0, null),
('"단순함은 궁극의 정교함이다" — 다빈치',
 'quote', now() - interval '23 days', now() - interval '23 days', 'normal', 0, null),
('타이포그래피는 배경이 아니라 목소리다.',
 'text', now() - interval '23 days', now() - interval '23 days', 'normal', 0, null),
('주말에: 필름 카메라 배터리 사기',
 'text', now() - interval '31 days', now() - interval '31 days', 'normal', 0, null),
('어릴 때 살던 집 앞 골목 냄새가 갑자기 떠올랐다. 비 온 다음 날 시멘트.',
 'text', now() - interval '34 days', now() - interval '34 days', 'normal', 0, null),
('https://vercel.com/blog/geist',
 'link', now() - interval '58 days', now() - interval '58 days', 'normal', 0, null),
('좋은 인터페이스는 사용자가 자기 머리를 쓰게 둔다.',
 'text', now() - interval '67 days', now() - interval '67 days', 'normal', 0, null),
('막힐 때는 문제를 줄이지 말고 문제를 바꿔라.',
 'text', now() - interval '103 days', now() - interval '103 days', 'normal', 0, null),
('산책 중: 도시의 소음에도 리듬이 있다. 신호등 주기 때문인 듯.',
 'text', now() - interval '131 days', now() - interval '131 days', 'normal', 0, null);

-- ============ 정리 (테스트 끝나면) ============
-- 위 파편은 전부 10일보다 오래됐고, 실제로 던진 파편은 전부 그보다 최근이다
-- (프로젝트 시작이 2026-07-12). 그래서 이 한 줄로 시드만 정확히 지워진다.
--
-- ⚠️ 나중에 진짜 오래된 파편이 쌓인 뒤에 이걸 실행하면 그것들까지 날아간다.
--    지우기 전에 select로 먼저 확인할 것:
--
--    select created_at, content from fragments where created_at < now() - interval '10 days';
--    delete from fragments where created_at < now() - interval '10 days';
