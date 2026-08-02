// 아침 브리핑 클라이언트 (RUDY.md §4-F4 · §4-A3).
//
// **앱은 만들지 않는다. 읽기만 한다.** (2026-08-02, 유저 지시)
// 만드는 건 맥에서 `node scripts/morning/run.mjs`가 한다 — 클코 한 방으로 파편 전량을 읽는다.
// 그래서 여기엔 생성 함수가 없다. 아침에 열면 이미 있거나, 없으면 없는 거다.
//
// 타입이 `scripts/morning/{material,run}.mjs`가 만드는 페이로드와 짝이다 — 한쪽만 고치면 조용히 갈라진다.

import { isConfigured, supabase } from './supabase';

export type MorningItem = {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  vividness: number;
  projects: string[];
};

export type MorningAxis = {
  label: string;
  kind: '지속' | '중간' | '단발';
  count: number;
  spanDays: number;
  quietDays: number;
  activeDays: number;
  marks: { offset: number; vividness: number }[];
  /** 이 결의 증거가 최근 7일에 몇 개 / 그 앞 3주에 몇 개 — 관심사 변화를 의미 단위로 잰 값 */
  recent: number;
  prior: number;
  items: MorningItem[];
  stated: string[];
};

export type MorningTrends = {
  volume: { recent: number; prior: number; priorPerWeek: number };
  domains: { host: string; count: number }[];
  types: { type: string; recent: number; prior: number }[];
  projectShare: { name: string; recent: number; prior: number }[];
};

export type MorningStats = {
  trends: MorningTrends;
  today: MorningItem[];
  yesterday: MorningItem[];
  axes: MorningAxis[];
  bands: { label: string; count: number }[];
  quietProjects: { name: string; days: number; total: number }[];
  rhythm: { offset: number; count: number }[];
  fading: MorningItem[];
  nudgeCandidates: { id: string; title: string; days: number }[];
  totals: { alive: number; fading: number; sunk: number };
};

export type MorningNudge = { utteranceId: string | null; fragmentId: string; question: string };

/**
 * 하루에 하나. 다섯 종류 중 하나(반복되는 질문 / 지속되는 가치관 / 충돌하는 관심사 /
 * 사고방식 변화 / 호기심 변화). `items`가 근거다 — **몇 개로 본 건지 보이는 게 이 카드의 핵심**이라
 * 비어 있으면 카드를 안 그린다.
 */
export type MorningPattern = { kind: string; text: string; items: MorningItem[] };

/** 성찰 질문. 답하면 `rudy.evidence`에 쌓여 다음 브리핑이 추측 대신 인용을 할 수 있게 된다. */
export type MorningQuestion = { utteranceId: string | null; text: string };

export type MorningBrief = {
  id: string | null;
  createdAt: string;
  headline: string;
  /** 제목 없는 평문 문단들 */
  reading: string[];
  pattern: MorningPattern | null;
  question: MorningQuestion | null;
  rejected: string[];
  stats: MorningStats;
  nudge: MorningNudge | null;
  costUsd: number | null;
};

type BriefRow = { id: string; created_at: string; text: string | null; cost_usd: number | null };

// 원장 행 하나를 화면이 쓰는 형태로 푼다. `fetchTodayMorning`·`fetchMorningById`가 공유한다.
async function parseBriefRow(row: BriefRow): Promise<MorningBrief | null> {
  if (!row.text) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(row.text);
  } catch {
    return null; // 옛 형식(마크다운)이 남아 있으면 없는 셈 친다
  }
  const nudge = (p.nudge ?? null) as MorningNudge | null;
  const question = (p.question ?? null) as MorningQuestion | null;
  const [nudgeDone, questionDone] = await Promise.all([
    answered(nudge?.utteranceId),
    answered(question?.utteranceId),
  ]);
  return {
    id: row.id,
    createdAt: row.created_at,
    costUsd: row.cost_usd ?? null,
    headline: (p.headline as string) ?? '',
    reading: (p.reading as string[]) ?? [],
    pattern: (p.pattern ?? null) as MorningPattern | null,
    question: questionDone ? null : question,
    rejected: (p.rejected as string[]) ?? [],
    stats: p.stats as MorningStats,
    nudge: nudgeDone ? null : nudge,
  };
}

// 오늘 이미 만든 브리핑. 없으면 null — 없으면 그냥 없는 것이다(§2-8).
export async function fetchTodayMorning(): Promise<MorningBrief | null> {
  return fetchMorningByDate(new Date());
}

// 특정 날짜에 만든 브리핑 — 데일리에서 그 날짜를 보고 있을 때 그 날의 카드를 보여주는 용도.
export async function fetchMorningByDate(date: Date): Promise<MorningBrief | null> {
  if (!isConfigured) return null;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const { data, error } = await supabase()
    .schema('rudy')
    .from('utterances')
    .select('id, created_at, text, cost_usd')
    .eq('surface', 'briefing')
    .eq('kind', 'pattern')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;

  const row = (data ?? [])[0];
  return row ? parseBriefRow(row as BriefRow) : null;
}

// 지난 브리핑 목록 — 제목 줄(headline)만 가볍게 뽑는다. 상세는 fetchMorningById에서.
export type MorningListItem = {
  id: string;
  createdAt: string;
  headline: string;
  costUsd: number | null;
};

export async function fetchMorningList(): Promise<MorningListItem[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase()
    .schema('rudy')
    .from('utterances')
    .select('id, created_at, text, cost_usd')
    .eq('surface', 'briefing')
    .eq('kind', 'pattern')
    .not('text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  const items: MorningListItem[] = [];
  for (const r of (data ?? []) as BriefRow[]) {
    try {
      const p = JSON.parse(r.text as string);
      items.push({
        id: r.id,
        createdAt: r.created_at,
        headline: (p.headline as string) ?? '',
        costUsd: r.cost_usd ?? null,
      });
    } catch {
      // 옛 형식은 목록에서도 건너뛴다
    }
  }
  return items;
}

export async function fetchMorningById(id: string): Promise<MorningBrief | null> {
  if (!isConfigured) return null;
  const { data, error } = await supabase()
    .schema('rudy')
    .from('utterances')
    .select('id, created_at, text, cost_usd')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? parseBriefRow(data as BriefRow) : null;
}

// 기록에서 지우기 — discovery.tsx의 deleteBriefing과 같은 자리(사후 폐기).
export async function deleteMorning(id: string): Promise<void> {
  if (!isConfigured) return;
  const { error } = await supabase().schema('rudy').from('utterances').delete().eq('id', id);
  if (error) throw error;
}

// ⚠️ 브리핑 본문은 원장에 **JSON으로 굳어 있다** — 답해도 그 JSON은 안 바뀐다.
// 그래서 다시 열면 흘려보낸 넛지가 그대로 살아 돌아왔다(2026-08-01 유저 신고).
// 판정의 원천은 굳은 JSON이 아니라 **그 발화 행의 user_response**다. 질문도 같은 규칙을 탄다.
async function answered(utteranceId: string | null | undefined): Promise<boolean> {
  if (!utteranceId) return false;
  const { data } = await supabase()
    .schema('rudy')
    .from('utterances')
    .select('user_response')
    .eq('id', utteranceId)
    .maybeSingle();
  return !!data?.user_response;
}

/**
 * 성찰 질문에 답한 걸 **자기 진술**로 남긴다 (§4-B2). 이게 쌓여야 루디가 "내 추측인데" 대신
 * "네가 이렇게 말했잖아"를 쓸 수 있다 — `findAxes`가 축마다 이 진술을 붙여준다.
 *
 * 임베딩은 안 붙인다(앱에 임베딩 경로가 없다). `findAxes`는 `stated_text`·`related_item_ids`만 읽으므로
 * 없어도 제 일을 한다 — 없는 걸 만들려고 앱에 OpenAI 키를 들이지 않는다.
 */
export async function answerQuestion(
  utteranceId: string,
  relatedItemIds: string[],
  text: string,
): Promise<void> {
  if (!isConfigured) return;
  await supabase()
    .schema('rudy')
    .from('evidence')
    .insert({ stated_text: text, related_item_ids: relatedItemIds, utterance_id: utteranceId });
  await supabase()
    .schema('rudy')
    .from('utterances')
    .update({ user_response: 'acted', responded_at: new Date().toISOString() })
    .eq('id', utteranceId);
}
