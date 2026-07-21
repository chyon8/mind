// 아침 푸시 (RUDY.md §4-F4 · §7-3 · §10-8). pg_cron이 하루 한 번 호출한다 (rudy-cron.sql).
//
// 하는 일: (1) 어제 관찰 한 줄 계산(§4-F5 거울 정신 — 관찰이지 처방 아님) → (2) 발견 엔진 재사용해서
// 그 줄을 앞에 얹고 브리핑 생성 → (3) 볼 게 있으면만 푸시 발송(§2-8 침묵 기본값, 빈 브리핑 금지).
//
// ⚠️ 발견 화면의 "새로 발견하기"와 **같은 엔진**이다(streamBrief). 다른 표면을 새로 안 만든다 —
// trigger='push' 태그만 다르게 남겨서 기록 목록이 "아침 브리핑"으로 구분 표시하게 한다(유저 요청).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { streamBrief } from '../discovery/brief.ts';
import { kstRange, kstToday } from '../_shared/time.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

function logGate(passed: boolean, reason: string, detail: unknown) {
  supabase
    .schema('rudy')
    .from('gate_log')
    .insert({ surface: 'briefing', kind: 'discovery', gate: 'budget', passed, reason, detail })
    .then(undefined, (e) => console.warn('[morning] gate_log 실패', e));
}

type ProjectCount = { name: string; status: string; count: number };

// 어제(KST) 프로젝트별 저장 개수. §4-F5: "이번 주의 너"는 규정이 아니라 스냅샷 — 숫자를 말해도
// 처방("오늘은 X 하세요")만 안 섞으면 관찰이다. 아무 신호도 없으면 관찰 자체를 생략한다(§2-8).
async function observationLine(): Promise<string> {
  const { since, until } = kstRange('yesterday');
  const [{ data: projects }, { data: frags }, { data: maps }] = await Promise.all([
    supabase.from('projects').select('id, name, status').eq('status', 'active'),
    supabase.from('fragments').select('id').eq('archived', false).gte('created_at', since).lt('created_at', until),
    supabase.from('fragment_projects').select('fragment_id, project_id'),
  ]);
  const yesterdayIds = new Set((frags ?? []).map((f) => f.id as string));
  const counts = new Map<string, number>();
  for (const m of maps ?? []) {
    if (!yesterdayIds.has(m.fragment_id as string)) continue;
    counts.set(m.project_id as string, (counts.get(m.project_id as string) ?? 0) + 1);
  }
  const withCount: ProjectCount[] = (projects ?? [])
    .map((p) => ({ name: p.name as string, status: p.status as string, count: counts.get(p.id as string) ?? 0 }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  if (!withCount.length) return ''; // 어제 아무 프로젝트도 안 건드렸다 — 침묵이 낫다. 지어내지 않는다.
  const parts = withCount.slice(0, 3).map((p) => `${p.name}에 ${p.count}개`);
  return `어제는 ${parts.join(', ')} 남겼다.`;
}

async function sendPush(title: string, body: string) {
  const { data: tokens } = await supabase.schema('rudy').from('push_tokens').select('token');
  const list = (tokens ?? []).map((t) => t.token as string);
  if (!list.length) return;

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(
      list.map((to) => ({ to, title, body, data: { screen: 'discovery' } })),
    ),
  });
  const json = await res.json().catch(() => null);
  // 만료된 토큰은 지운다 — 다음날 또 실패할 걸 계속 시도하지 않게.
  const dead = ((json?.data ?? []) as { status: string; details?: { error?: string } }[])
    .map((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? list[i] : null))
    .filter((t): t is string => !!t);
  if (dead.length) {
    await supabase.schema('rudy').from('push_tokens').delete().in('token', dead);
  }
}

// 첫 카드 제목만 미리보기로 뽑는다 (알림 body는 짧아야 한다)
function firstTitle(md: string): string {
  const m = md.match(/^###\s+(.+)$/m);
  return m ? m[1].trim() : '오늘의 발견';
}

Deno.serve(async (req) => {
  try {
    // 하루 1회 상한 (§2-6 발화 예산). cron이 중복 호출되거나 재시도해도 두 번 안 보낸다.
    const { since } = kstRange('today');
    const { data: already } = await supabase
      .schema('rudy')
      .from('utterances')
      .select('id')
      .eq('kind', 'discovery')
      .eq('surface', 'briefing')
      .eq('trigger', 'push')
      .gte('created_at', since)
      .limit(1);
    if (already?.length) {
      logGate(false, '오늘 이미 보냈다', { date: kstToday() });
      return new Response(JSON.stringify({ skipped: 'already_sent_today' }), { status: 200 });
    }

    const prelude = await observationLine();

    let full = '';
    let empty = true;
    for await (const ev of streamBrief(supabase, { trigger: 'push', prelude: prelude || undefined })) {
      if (ev.t === 'd') full += ev.c;
      if (ev.t === 'done') empty = ev.empty;
    }

    if (empty) {
      logGate(false, '볼 게 없다 — 빈 브리핑 (§2-8)', { hadObservation: !!prelude });
      return new Response(JSON.stringify({ skipped: 'empty' }), { status: 200 });
    }

    logGate(true, '발송', { hadObservation: !!prelude, chars: full.length });
    await sendPush('발견', firstTitle(full));

    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (e) {
    console.error('[morning-briefing]', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
