// 배포된 chat Edge Function을 앱 없이 통짜로 검증한다 (진단용).
//   node scripts/check-chat.mjs                          ← 기본 질문
//   node scripts/check-chat.mjs "내가 음악 관련 뭐 저장했지?"
//   node scripts/check-chat.mjs --keep "질문"            ← 대화를 지우지 않고 남긴다
//
// 검사 항목:
//   1. 스트리밍이 토큰 단위로 오는가 (한 덩어리로 오면 스트리밍이 죽은 것)
//   2. done 이벤트 + saved:true가 오는가 (없으면 앱이 답을 증발시킨다)
//   3. messages에 user/assistant 두 줄이 실제로 적혔는가
//   4. touch 불변 — 채팅이 파편의 last_touched_at을 건드리지 않았는가 (RUDY.md §2-3)
// 끝나면 만든 대화를 지운다 (--keep 제외). 파편은 절대 건드리지 않는다.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없으면 순수 env로 */ }

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('환경변수 부족: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  process.exit(1);
}

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const question = args.filter((a) => a !== '--keep')[0] ?? '내가 홈레코딩 관련 저장한 거 있어?';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: 'rudy' } });
const pub = createClient(SUPABASE_URL, SERVICE_ROLE);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// touch 불변 검증용 스냅샷 — 채팅 전후로 파편의 last_touched_at 최대값이 같아야 한다
async function touchSnapshot() {
  const { data } = await pub
    .from('fragments')
    .select('last_touched_at')
    .order('last_touched_at', { ascending: false })
    .limit(1);
  return data?.[0]?.last_touched_at ?? null;
}

const touchBefore = await touchSnapshot();

const { data: conv, error: convErr } = await supabase.from('conversations').insert({}).select('id').single();
if (convErr) {
  console.error('대화 생성 실패 (rudy-chat.sql 실행했나?):', convErr.message);
  process.exit(1);
}

console.log(`질문: "${question}"\n`);
const t0 = Date.now();
const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversationId: conv.id, question }),
});
check(res.ok, `HTTP ${res.status}`, res.ok ? '' : await res.text());

let answer = '';
let tokenEvents = 0;
let firstTokenMs = null;
let doneEvent = null;
let linkEvent = null;
let errorEvent = null;

// NDJSON 파싱 — src/lib/ndjson.ts와 같은 규칙(마지막 버퍼 flush 포함)
let buffer = '';
const handle = (raw) => {
  if (!raw.trim()) return;
  const ev = JSON.parse(raw);
  if (ev.t === 'd') {
    if (tokenEvents === 0) firstTokenMs = Date.now() - t0;
    tokenEvents += 1;
    answer += ev.c;
  } else if (ev.t === 'done') doneEvent = ev;
  else if (ev.t === 'link') linkEvent = ev;
  else if (ev.t === 'error') errorEvent = ev;
};
const decoder = new TextDecoder();
for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const l of lines) handle(l);
}
handle(buffer);

check(errorEvent === null, '스트림 에러 없음', errorEvent?.message ?? '');
check(tokenEvents > 1, `스트리밍 (토큰 이벤트 ${tokenEvents}개, 첫 토큰 ${firstTokenMs}ms)`,
  tokenEvents <= 1 ? '한 덩어리로 왔다 — 스트리밍 죽음' : '');
check(!!doneEvent, 'done 이벤트 수신', doneEvent ? '' : '없음 — 앱이 답을 증발시킨다');
check(doneEvent?.saved === true, '서버 저장 확인(saved:true)');
if (linkEvent) console.log(`   (자발적 연결 발화: fragment ${linkEvent.fragmentId})`);

const { data: msgs } = await supabase
  .from('messages')
  .select('role, content, cited_ids')
  .eq('conversation_id', conv.id)
  .order('created_at');
check(msgs?.length === 2, `messages에 2줄 적힘 (실제 ${msgs?.length ?? 0})`);
const assistant = msgs?.find((m) => m.role === 'assistant');
const citeCount = assistant?.cited_ids?.length ?? 0;
check(citeCount > 0, `근거 검색됨 ${citeCount}개`);
// 파편을 실제로 언급했으면 반드시 링크여야 한다. 다만 세상 지식 질문("재즈 화성이 뭐야?")이나
// 진짜 없는 것("여권번호")은 인용 자체가 없는 게 정답이므로 링크를 요구하지 않는다.
const body = assistant?.content ?? '';
// 링크는 두 형태 다 정답이다: 파편으로 가는 mind:// 와, "링크 줘"에 답하는 원본 http.
// 파편 내용을 실제로 옮겨 적었을 때만 링크를 요구한다 — 세상 지식 답변("재즈 화성이 뭐야?")은
// 인용이 없는 게 정답이라 링크가 없어야 정상이다.
const hasLink = /mind:\/\/fragment\/|\]\(https?:\/\//.test(body);
const { data: citedFrs } = await pub.from('fragments').select('content, link_title').in('id', assistant?.cited_ids ?? []);
const quoted = (citedFrs ?? []).some((f) => {
  const head = (f.link_title || f.content || '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return head.length >= 6 && body.includes(head);
});
check(hasLink || !quoted, '파편을 옮겨 적었으면 링크로 검 (mind:// 또는 원본 URL)',
  hasLink || !quoted ? (quoted ? '' : '인용 없는 답변 — 링크 불필요') : '파편을 말하면서 링크를 안 걸었다');
// 자리표시자를 그대로 뱉는 회귀 (2026-07-19): [『내용 요약』](mind://…)
check(!/\[[『']?내용 요약[』']?\]|\[제목\]/.test(body), '링크 글자가 자리표시자가 아님',
  /내용 요약/.test(body) ? '모델이 예시 문구를 그대로 복사했다' : '');

const touchAfter = await touchSnapshot();
check(touchBefore === touchAfter, 'touch 불변 (last_touched_at 변화 없음)',
  touchBefore === touchAfter ? '' : `${touchBefore} → ${touchAfter} ⚠️ §2-3 위반!`);

console.log(`\n─── 답변 (${answer.length}자) ───\n${answer}\n───`);

if (keep) console.log(`\n대화 유지: ${conv.id}`);
else await supabase.from('conversations').delete().eq('id', conv.id);

console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
