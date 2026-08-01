// 아침 브리핑의 **계산된 사실** (RUDY.md §4-F4).
//
// 여기서 나오는 건 전부 코드가 센 것이다. 모델은 이 숫자를 만들지도, 다시 세지도 않는다 —
// 모델이 날짜에서 추론하게 두면 "요즘 꽂혀 있네" 같은 말을 근거 없이 한다(clusters.ts §138 교훈).
// 역할 분담: **코드가 숫자를 만들고, UI가 그림을 그리고, 모델은 주장만 쓴다.**
//
// ⚠️ 축(axes)은 findAxes를 그대로 쓴다. 클러스터 로직을 여기서 다시 짜면 채팅의 축과
//    갈라져서 "채팅은 이렇게 말하는데 아침은 저렇게 말한다"가 된다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { findAxes } from '../chat/clusters.ts';
import { vividness } from '../_shared/cluster.ts';
import { kstDate, kstRange } from '../_shared/time.ts';
import type { UsageSink } from '../_shared/openai.ts';

const MS_PER_DAY = 86_400_000;
const FLOOR = 0.15; // 감쇠의 바닥
const NEAR_FLOOR = 0.7; // recall.ts·orient.ts와 같은 기준 — "아직 흐려지는 중"
const RHYTHM_DAYS = 14; // 저장 리듬 막대 길이
const TIMELINE_DAYS = 30; // 축 타임라인 도트 길이

// 경향 비교 창. 최근 1주 vs 그 앞 3주 — "요즘"이 무엇과 비교해서 요즘인지를 고정한다.
const RECENT_DAYS = 7;
const PRIOR_DAYS = 28;

// ⚠️ 여기 **단어 빈도 세기(형태소 토큰화)를 다시 넣지 마라.** 2026-08-01에 만들었다가 버렸다.
//    유저 지시가 "반복되는 키워드"였는데 글자 그대로 받아 한국어 토크나이저를 손으로 짰고,
//    실측 상위가 `https·com·www·아니라·이렇게·있다`였다. 불용어를 아무리 채워도 나오는 건
//    **단어 카운트지 의미가 아니다** ("옵시디언 3/0"은 통찰이 아니다).
//    의미는 이미 있는 것으로 뽑는다 — **임베딩 클러스터(findAxes)**. 아래 axes의 recent/prior가 그것이다.

export type Trends = {
  volume: { recent: number; prior: number; priorPerWeek: number };
  /** 링크를 어디서 주워오나 */
  domains: { host: string; count: number }[];
  types: { type: string; recent: number; prior: number }[];
  projectShare: { name: string; recent: number; prior: number }[];
};

type Row = {
  id: string;
  created_at: string;
  content: string | null;
  type: string;
  link_title: string | null;
  link_description: string | null;
  note: string | null;
  last_touched_at: string;
  tier: string;
  touch_count: number;
};

const COLS =
  'id, created_at, content, type, link_title, link_description, note, last_touched_at, tier, touch_count';

export type Item = {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  vividness: number;
  projects: string[];
};

export type AxisView = {
  label: string;
  kind: '지속' | '중간' | '단발';
  count: number;
  spanDays: number;
  quietDays: number;
  activeDays: number;
  /** 최근 30일 타임라인. offset 0 = 오늘. 같은 날 여러 개면 제일 선명한 값을 쓴다. */
  marks: { offset: number; vividness: number }[];
  /**
   * 이 덩어리의 증거가 언제 쌓였나 — **관심사 변화를 의미 단위로 재는 자리.**
   * recent(최근 7일) > prior(그 앞 3주)면 굵어지는 중, 반대면 잦아드는 중, 둘 다 있으면 상수.
   */
  recent: number;
  prior: number;
  items: Item[];
  stated: string[];
};

export type MorningStats = {
  today: Item[];
  yesterday: Item[];
  axes: AxisView[];
  /** 선명도 지형 — 저장소가 지금 얼마나 흐려져 있나 */
  bands: { label: string; count: number }[];
  /** active인데 파편이 안 붙는 프로젝트 */
  quietProjects: { name: string; days: number; total: number }[];
  /** 최근 14일 저장 리듬 (offset 0 = 오늘) */
  rhythm: { offset: number; count: number }[];
  /** 흐려지는 중이면서 아직 바닥은 아닌 것 — "지금 놓치고 있는 것" */
  fading: Item[];
  nudgeCandidates: { id: string; title: string; days: number }[];
  totals: { alive: number; fading: number; sunk: number };
  trends: Trends;
  /**
   * 모델에 넘길 재료 텍스트. 같은 데이터를 두 소비자가 다르게 쓴다 —
   * 위 필드들은 **UI가 그림으로**, 이 블록은 **모델이 주장으로**. 그래서 한 번만 읽는다.
   */
  block: string;
};

const titleOf = (f: Row) =>
  ((f.type === 'link' ? (f.link_title ?? f.content) : f.content) ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

const daysAgo = (iso: string, now: Date) =>
  Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);

export async function buildStats(
  supabase: SupabaseClient,
  now = new Date(),
  onUsage?: UsageSink,
  meta?: Record<string, string>,
): Promise<MorningStats> {
  const { since: ydayStart, until: todayStart } = kstRange('yesterday');

  const [fragRes, projRes, mapRes, axesRaw] = await Promise.all([
    supabase.from('fragments').select(COLS).eq('archived', false).is('let_go_at', null),
    supabase.from('projects').select('id, name, status, description').neq('status', 'done'),
    supabase.from('fragment_projects').select('fragment_id, project_id'),
    // 축은 실패해도 브리핑 전체를 죽이지 않는다 (RPC 미배포·임베딩 미생성 등).
    // morning_edges = cluster_edges에서 프로젝트 제외만 뺀 판 (rudy-morning.sql).
    // 실측(2026-08-01): 제외를 두면 이 코퍼스에서 축이 0개라 화면이 통째로 빈다.
    findAxes(supabase, now, onUsage, meta, 'morning_edges').catch((e) => {
      console.warn('[morning] findAxes 실패 → 축 없이', e);
      return [];
    }),
  ]);
  if (fragRes.error) throw fragRes.error;

  const rows = (fragRes.data ?? []) as Row[];
  const projects = (projRes.data ?? []) as {
    id: string;
    name: string;
    status: string;
    description: string | null;
  }[];
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const projectsOf = new Map<string, string[]>();
  for (const m of (mapRes.data ?? []) as { fragment_id: string; project_id: string }[]) {
    const name = nameById.get(m.project_id);
    if (!name) continue;
    projectsOf.set(m.fragment_id, [...(projectsOf.get(m.fragment_id) ?? []), name]);
  }

  const toItem = (f: Row): Item => ({
    id: f.id,
    title: titleOf(f),
    type: f.type,
    createdAt: f.created_at,
    vividness: vividness(f, now),
    projects: projectsOf.get(f.id) ?? [],
  });

  const byNewest = (a: Row, b: Row) => b.created_at.localeCompare(a.created_at);
  const today = rows.filter((f) => f.created_at >= todayStart).sort(byNewest).map(toItem);
  const yesterday = rows
    .filter((f) => f.created_at >= ydayStart && f.created_at < todayStart)
    .sort(byNewest)
    .map(toItem);

  // 선명도 지형 — 세 밴드. 유저가 "지금 저장소가 어떤 상태인가"를 한눈에 보는 자리다.
  let vivid = 0;
  let fadingN = 0;
  let sunk = 0;
  for (const f of rows) {
    const v = vividness(f, now);
    if (v > NEAR_FLOOR) vivid++;
    else if (v > FLOOR) fadingN++;
    else sunk++;
  }

  const recentCut = now.getTime() - RECENT_DAYS * MS_PER_DAY;
  const priorCut = now.getTime() - PRIOR_DAYS * MS_PER_DAY;

  // 축 타임라인 — 같은 날 여러 파편이면 제일 선명한 것으로 접는다(도트가 겹쳐도 정보는 하나).
  const axes: AxisView[] = axesRaw.map((a) => {
    const best = new Map<number, number>();
    for (const f of a.items) {
      const off = daysAgo(f.created_at, now);
      if (off < 0 || off >= TIMELINE_DAYS) continue;
      const v = vividness(f, now);
      best.set(off, Math.max(best.get(off) ?? 0, v));
    }
    const at = (f: { created_at: string }) => new Date(f.created_at).getTime();
    return {
      recent: a.items.filter((f) => at(f) >= recentCut).length,
      prior: a.items.filter((f) => at(f) < recentCut && at(f) >= priorCut).length,
      label: a.label,
      kind: a.kind,
      count: a.items.length,
      spanDays: Math.round(a.spanDays),
      quietDays: Math.round(a.quietDays),
      activeDays: a.activeDays,
      marks: [...best.entries()]
        .map(([offset, v]) => ({ offset, vividness: v }))
        .sort((x, y) => x.offset - y.offset),
      items: a.items.map((f) => toItem(f as unknown as Row)),
      stated: a.stated,
    };
  });

  // 조용한 프로젝트 — active인데 마지막 파편이 오래된 것. §4-A3의 프로젝트 판이다.
  const lastByProject = new Map<string, string>();
  const countByProject = new Map<string, number>();
  for (const f of rows) {
    for (const name of projectsOf.get(f.id) ?? []) {
      countByProject.set(name, (countByProject.get(name) ?? 0) + 1);
      const cur = lastByProject.get(name);
      if (!cur || f.created_at > cur) lastByProject.set(name, f.created_at);
    }
  }
  const quietProjects = projects
    .filter((p) => p.status === 'active')
    .map((p) => ({
      name: p.name,
      days: lastByProject.has(p.name) ? daysAgo(lastByProject.get(p.name)!, now) : 999,
      total: countByProject.get(p.name) ?? 0,
    }))
    .filter((p) => p.days >= 7) // 일주일 넘게 아무것도 안 붙은 것만
    .sort((a, b) => b.days - a.days);

  // 저장 리듬 — 최근 14일 일별 개수.
  const perDay = new Map<string, number>();
  for (const f of rows) perDay.set(kstDate(f.created_at), (perDay.get(kstDate(f.created_at)) ?? 0) + 1);
  const rhythm = Array.from({ length: RHYTHM_DAYS }, (_, offset) => ({
    offset,
    count: perDay.get(kstDate(new Date(now.getTime() - offset * MS_PER_DAY).toISOString())) ?? 0,
  }));

  // 흐려지는 중 — 아직 바닥은 아니라 지금이 마지막 기회인 것들. 흐릴수록 위로.
  const fading = rows
    .filter((f) => {
      const v = vividness(f, now);
      return v > FLOOR && v <= NEAR_FLOOR;
    })
    .map(toItem)
    .sort((a, b) => a.vividness - b.vividness)
    .slice(0, 8);

  // 넛지 후보 (§4-A3) — 한 번도 안 건드린 채 바닥까지 간 것. 오래된 순.
  const nudgeCandidates = rows
    .filter((f) => f.touch_count === 0 && vividness(f, now) <= FLOOR)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((f) => ({ id: f.id, title: titleOf(f), days: daysAgo(f.created_at, now) }));

  // ── 경향 (2026-08-01 재설계). 유저 지시: "파편별로 엮는 건 아예 안 중요하다.
  //    어떤 류를 많이 저장했고, 관심사가 어떻게 변했고, 자주 말하는 게 뭔지를 말해라."
  //    그래서 여기서 **집계**를 만들고, 모델에는 이것만 준다(파편 목록은 안 준다).
  const isRecent = (f: Row) => new Date(f.created_at).getTime() >= recentCut;
  const isPrior = (f: Row) => {
    const t = new Date(f.created_at).getTime();
    return t < recentCut && t >= priorCut;
  };
  const recentRows = rows.filter(isRecent);
  const priorRows = rows.filter(isPrior);

  const hostOf = (f: Row) => {
    if (f.type !== 'link') return null;
    const m = (f.content ?? '').match(/^https?:\/\/(?:www\.)?([^/?#]+)/i);
    return m ? m[1].toLowerCase() : null;
  };
  const hostCount = new Map<string, number>();
  for (const f of rows.filter((x) => new Date(x.created_at).getTime() >= priorCut)) {
    const h = hostOf(f);
    if (h) hostCount.set(h, (hostCount.get(h) ?? 0) + 1);
  }
  const domains = [...hostCount.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const typeCount = (list: Row[]) => {
    const m = new Map<string, number>();
    for (const f of list) m.set(f.type, (m.get(f.type) ?? 0) + 1);
    return m;
  };
  const tRecent = typeCount(recentRows);
  const tPrior = typeCount(priorRows);
  const types = [...new Set([...tRecent.keys(), ...tPrior.keys()])].map((type) => ({
    type,
    recent: tRecent.get(type) ?? 0,
    prior: tPrior.get(type) ?? 0,
  }));

  const shareCount = (list: Row[]) => {
    const m = new Map<string, number>();
    for (const f of list) for (const n of projectsOf.get(f.id) ?? []) m.set(n, (m.get(n) ?? 0) + 1);
    return m;
  };
  const sRecent = shareCount(recentRows);
  const sPrior = shareCount(priorRows);
  const projectShare = [...new Set([...sRecent.keys(), ...sPrior.keys()])]
    .map((name) => ({ name, recent: sRecent.get(name) ?? 0, prior: sPrior.get(name) ?? 0 }))
    .sort((a, b) => b.recent - a.recent || b.prior - a.prior);

  const trends: Trends = {
    volume: {
      recent: recentRows.length,
      prior: priorRows.length,
      priorPerWeek: Math.round((priorRows.length / ((PRIOR_DAYS - RECENT_DAYS) / 7)) * 10) / 10,
    },
    domains,
    types,
    projectShare,
  };

  // ── 모델용 재료. **파편 목록을 주지 않는다.**
  // 2026-08-01 유저 판정: 파편을 하나씩 인용해 억지로 엮는 게 "제일 최악". 보여주면 따라간다 —
  // 프롬프트로 "엮지 마라"라고 부탁하는 건 안 지켜진다(RUDY-DISCOVERY §7-f의 2단계 분리와 같은 판단).
  // 그래서 **구조로 막는다**: 집계만 준다. 인용할 파편이 손에 없으면 인용할 수가 없다.
  const block = [
    '=== 이 사람이 하고 있는 일 ===',
    '※ 설명이 정답지다. 이름만 보고 넘겨짚지 마라.',
    projects
      .map((p) => `- ${p.name} (${p.status})${p.description ? ` — ${p.description.replace(/\s+/g, ' ')}` : ' — (설명 없음)'}`)
      .join('\n') || '(없음)',
    '',
    `=== 저장량 (최근 ${RECENT_DAYS}일 vs 그 앞 ${PRIOR_DAYS - RECENT_DAYS}일) ===`,
    `- 최근 ${RECENT_DAYS}일 ${trends.volume.recent}개 / 그 앞은 주당 평균 ${trends.volume.priorPerWeek}개`,
    `- 살아있는 파편 ${rows.length}개 = 또렷함 ${vivid} / 흐려지는 중 ${fadingN} / 바닥 ${sunk}`,
    '',
    // 관심사 변화의 본체. 단어가 아니라 **의미로 뭉친 덩어리**의 증거 분포다.
    `=== 관심의 결 — 의미로 뭉친 덩어리 (최근 ${RECENT_DAYS}일 / 그 앞 ${PRIOR_DAYS - RECENT_DAYS}일) ===`,
    '※ 안에 무슨 파편이 있는지는 안 준다. 이름과 분포로만 말해라.',
    axes.length
      ? axes
          .map(
            (a) =>
              `- ${a.label}: 최근 ${a.recent} / 이전 ${a.prior} (${a.kind} · 전체 ${a.count}개 · ${a.spanDays}일에 걸침${a.quietDays >= 7 ? ` · ${a.quietDays}일째 조용` : ''})`,
          )
          .join('\n')
      : '(덩어리가 안 잡혔다 — 이 경우 결 얘기는 하지 마라)',
    '',
    '=== 저장 형태 ===',
    types.map((t) => `${t.type} 최근 ${t.recent}/이전 ${t.prior}`).join(', '),
    domains.length ? `링크 출처: ${domains.map((d) => `${d.host} ${d.count}`).join(', ')}` : '',
    '',
    '=== 프로젝트별 저장 (최근/이전) ===',
    projectShare.map((p) => `${p.name} ${p.recent}/${p.prior}`).join(', ') || '(없음)',
    quietProjects.length
      ? `조용한 프로젝트: ${quietProjects.map((p) => `${p.name} ${p.days}일째`).join(', ')}`
      : '조용한 프로젝트 없음',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return {
    trends,
    today,
    yesterday,
    axes,
    bands: [
      { label: '또렷함', count: vivid },
      { label: '흐려지는 중', count: fadingN },
      { label: '바닥', count: sunk },
    ],
    quietProjects,
    rhythm,
    fading,
    nudgeCandidates,
    totals: { alive: rows.length, fading: fadingN, sunk },
    block,
  };
}
