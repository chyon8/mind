// 아침 브리핑 엔드포인트 (RUDY.md §4-F4 · §4-A3).
//
// 발견(discovery)과 **다른 물건이다.** 검색이 없고 바깥에 안 나간다 — 유저 확정(2026-07-29):
// "아침 브리핑은 발견은 하지 말고 그냥 관찰 정도만. 근데 관찰을 좀 더 디테일하게."
// 그래서 streamBrief를 재사용하지 않는다(재사용하면 발견이 다시 딸려온다).
//
// 역할 분담이 이 파일의 전부다:
//   stats.ts = 세고 계산한다 · 앱 = 그림으로 그린다 · prompt.ts = 주장만 쓴다
// LLM 호출은 축 라벨링(FAST_MODEL)과 주장 쓰기 한 번, 검색 0회.
//
// 원장엔 두 행: 브리핑 본문(kind='pattern')과 넛지(kind='nudge').
// 둘 다 kind가 'discovery'가 아니라 **발견 기록 목록에는 안 뜬다**(rudy.ts fetchBriefings).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { complete, DISCOVERY_MODEL } from '../_shared/openai.ts';
import { kstToday } from '../_shared/time.ts';
import { costTracker } from '../_shared/usage.ts';
import { morningSystem } from './prompt.ts';
import { buildStats } from './stats.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 한 번 물어본 파편은 한동안 다시 안 묻는다. 매일 같은 걸 물으면 그게 잔소리다 —
// §4-A3의 "죄책감 유발 금지"는 화법만이 아니라 빈도의 문제이기도 하다.
const NUDGE_COOLDOWN_DAYS = 30;

type Written = { headline: string; reading: string[]; rejected: string[] };

// 모델이 코드펜스로 감싸는 습관은 프롬프트로 못 막는다 — 파서가 견딘다 (RUDY-STATUS 교훈).
function parseWritten(raw: string): Written {
  const cleaned = raw.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  const p = JSON.parse(cleaned);
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : [];
  return {
    headline: typeof p?.headline === 'string' ? p.headline.trim() : '',
    // 파편 링크를 걸지 말라고 했지만 걸어도 화면이 안 깨지게 마크업만 벗긴다 (파서가 견딘다).
    reading: strings(p?.reading).map((s) => s.replace(/\[([^\]]+)\]\(mind:\/\/[^)]+\)/g, '$1')),
    rejected: strings(p?.rejected),
  };
}

async function pickNudge(
  candidates: { id: string; title: string; days: number }[],
  now: Date,
): Promise<{ utteranceId: string | null; fragmentId: string; question: string } | null> {
  if (!candidates.length) return null;
  const since = new Date(now.getTime() - NUDGE_COOLDOWN_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .schema('rudy')
    .from('utterances')
    .select('item_ids')
    .eq('kind', 'nudge')
    .gte('created_at', since);
  const asked = new Set((data ?? []).flatMap((r) => (r.item_ids ?? []) as string[]));
  const target = candidates.find((c) => !asked.has(c.id)); // 이미 오래된 순으로 정렬돼 있다
  if (!target) return null;

  // **질문 문장은 모델이 안 쓴다 — 여기서 만든다.** 그래야 §4-A3의 "반드시 질문형"과
  // "죄책감 유발 화법 금지"가 프롬프트 부탁이 아니라 코드로 지켜진다.
  const question = `${target.days}일째 한 번도 안 건드렸어. 버릴까, 진짜 할까?`;
  const { data: row } = await supabase
    .schema('rudy')
    .from('utterances')
    .insert({
      surface: 'briefing',
      kind: 'nudge',
      trigger: 'push',
      item_ids: [target.id],
      text: question, // 앱이 다시 열렸을 때 이 행만 읽으면 복원된다
    })
    .select('id')
    .single();
  return { utteranceId: (row?.id as string) ?? null, fragmentId: target.id, question };
}

async function run(): Promise<Response> {
  const now = new Date();
  const requestId = crypto.randomUUID();
  const cost = costTracker(supabase, { requestId });

  const stats = await buildStats(
    supabase,
    now,
    cost.track('morning.axes', 'gpt-4o-mini'),
    cost.meta('morning.axes'),
  );

  const raw = await complete(
    [
      { role: 'system', content: morningSystem(kstToday(now)) },
      { role: 'user', content: stats.block },
    ],
    DISCOVERY_MODEL,
    cost.track('morning.write', DISCOVERY_MODEL),
    cost.meta('morning.write'),
  );
  const written = parseWritten(raw);
  const { usd } = cost.result();

  const nudge = await pickNudge(stats.nudgeCandidates, now);

  // 본문은 원장에 통째로 남긴다 — 앱이 다시 열려도 LLM을 또 안 태우려면 이 행이 원천이다.
  const { block: _block, ...view } = stats;
  const payload = { ...written, stats: view, nudge };
  const { data: row } = await supabase
    .schema('rudy')
    .from('utterances')
    .insert({
      surface: 'briefing',
      kind: 'pattern',
      trigger: 'push',
      item_ids: [], // 집계 발화라 인용한 파편이 없다 (2026-08-01 재설계)
      text: JSON.stringify(payload),
      cost_usd: usd,
    })
    .select('id, created_at')
    .single();

  return new Response(
    JSON.stringify({ id: row?.id ?? null, createdAt: row?.created_at ?? now.toISOString(), ...payload, costUsd: usd }),
    { headers: { ...cors, 'Content-Type': 'application/json' } },
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    return await run();
  } catch (e) {
    console.error('[morning]', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
