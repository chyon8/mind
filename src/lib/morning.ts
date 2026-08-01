// 아침 브리핑 클라이언트 (RUDY.md §4-F4 · §4-A3).
//
// 발견(rudy.ts streamBriefing)과 다른 엔드포인트다. 검색이 없어 한 호출이라 스트리밍하지 않는다.
//
// 서버가 만든 페이로드를 **원장에 통째로 JSON으로** 넣어둔다 — 앱이 다시 열리면 그 행을 읽을 뿐
// LLM을 또 태우지 않는다. 타입이 서버(morning/stats.ts)와 짝이라 한쪽만 고치면 조용히 갈라진다.

import { dayKey } from './dates';
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

export type MorningBrief = {
  id: string | null;
  createdAt: string;
  headline: string;
  /** 제목 없는 문단들. 개별 파편을 인용하지 않는다 — 집계만 말한다 (morning/prompt.ts 참고). */
  reading: string[];
  rejected: string[];
  stats: MorningStats;
  nudge: MorningNudge | null;
  costUsd: number | null;
};

export async function generateMorning(): Promise<MorningBrief> {
  if (!isConfigured) throw new Error('Supabase 미설정');
  const { data, error } = await supabase().functions.invoke('morning');
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data as MorningBrief;
}

// 오늘 이미 만든 브리핑. 없으면 null — 없으면 그냥 없는 것이다(§2-8).
export async function fetchTodayMorning(): Promise<MorningBrief | null> {
  if (!isConfigured) return null;
  const { data, error } = await supabase()
    .schema('rudy')
    .from('utterances')
    .select('id, created_at, text, cost_usd')
    .eq('surface', 'briefing')
    .eq('kind', 'pattern')
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) throw error;

  const today = dayKey(new Date().toISOString());
  const row = (data ?? []).find((r) => dayKey(r.created_at as string) === today);
  if (!row?.text) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(row.text as string);
  } catch {
    return null; // 옛 형식(마크다운)이 남아 있으면 없는 셈 친다
  }
  const nudge = (p.nudge ?? null) as MorningNudge | null;
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    costUsd: (row.cost_usd as number | null) ?? null,
    headline: (p.headline as string) ?? '',
    reading: (p.reading as string[]) ?? [],
    rejected: (p.rejected as string[]) ?? [],
    stats: p.stats as MorningStats,
    nudge: (await answered(nudge)) ? null : nudge,
  };
}

// ⚠️ 브리핑 본문은 원장에 **JSON으로 굳어 있다** — 넛지에 답해도 그 JSON은 안 바뀐다.
// 그래서 다시 열면 흘려보낸 넛지가 그대로 살아 돌아왔다(2026-08-01 유저 신고).
// 판정의 원천은 굳은 JSON이 아니라 **넛지 발화 행의 user_response**다. 여기서 그걸 확인한다.
async function answered(nudge: MorningNudge | null): Promise<boolean> {
  if (!nudge?.utteranceId) return false;
  const { data } = await supabase()
    .schema('rudy')
    .from('utterances')
    .select('user_response')
    .eq('id', nudge.utteranceId)
    .maybeSingle();
  return !!data?.user_response;
}
