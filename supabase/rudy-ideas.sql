-- Rudy §10-7 E1 — 아이디어 발견 (RUDY.md §4-E1)
-- Supabase 대시보드 > SQL Editor에 붙여넣기 후 실행. (rudy-ledger.sql 이후)
--
-- 아이디어는 원장에 kind='discovery', medium='idea'로 들어간다 (§5 스키마 그대로).
-- 여기서 더 필요한 건 **어떤 타입이었나** 하나뿐이다 — 5종 로테이션(§4-E1)이
-- "지난번에 뭘 썼나"를 알아야 돌아가기 때문.
--
-- ⚠️ 이건 유저에 대한 결론이 아니라 **루디 자신의 발화 기록**이다 (§2-1 무관).
--    "이 사람은 교차형 아이디어를 좋아한다" 같은 걸 적는 게 아니라
--    "지난번에 교차를 썼다"는 사실만 적는다.

alter table rudy.utterances
  add column if not exists variant text;

comment on column rudy.utterances.variant is
  '발화의 하위 타입. 아이디어(§4-E1) 5종 로테이션: cross|gap|next|revive|counter';
