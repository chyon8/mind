// 아침 브리핑 — 재료 로드 + 화면이 그릴 통계 (RUDY.md §4-F4).
//
// ⚠️ **`supabase/functions/morning/`을 지우고 여기로 옮겼다** (2026-08-02, 유저 지시:
//    "발견도 클코만 남기고 앱버튼 없애"). 재료 코드가 두 벌이면 조용히 갈라진다 —
//    `_discovery-lib.mjs`가 정확히 그 병을 앓았다. 그래서 Edge 함수를 남기지 않았다.
//
// ── 2026-08-02에 뒤집은 것 (실측 근거는 아래 각주)
//
// 1. **파편 본문을 다 준다.** 3차 설계는 "집계만 주고 파편은 안 준다"였는데(억지 엮기 방지),
//    그 결과 모델이 받은 게 1,461토큰이었고 **네 문단 중 셋이 사실로 틀렸다.**
//    실측(2026-08-01 브리핑 대조):
//      · "앞선 3주 평균보다 네 배 몰렸다" → 실제 저장은 오히려 줄었다 (아래 2번)
//      · "최근엔 link가 새로 섞였다(이전 0)" → 이전 3주에 링크 44개. 전부 묻혀서 안 보였을 뿐
//      · "채팅 개선은 잦아드는 중" → 7/29 하루에만 채팅 파편 4~5개. 전부 묻혀서 안 보였을 뿐
//    억지 엮기는 재료가 아니라 **출력 형식**으로 막는다 (prompt.md: 패턴 1개 + 가설 화법 + 근거 표시).
//
// 2. **묻은 것(archived)을 뺀 게 거짓말의 원인이었다.** 이 사람에게 묻기는 "버림"이 아니라
//    **"정리됨"**이다 — 본인이 7/31에 그렇게 썼다("아이디어를 넣어놓고 한번 쭉 정리하면서
//    묻기하고있는데"). 최근 것은 아직 정리 전이라 살아 있고 옛것은 정리돼서 묻혔다.
//    → 살아있는 것만 세면 **무엇을 재든 "요즘이 폭발했다"가 나온다**(생존편향).
//    실측 2026-08-01: 전체 386개 중 살아있는 게 58개(15%). 최근 7일 118개 vs 그 앞 268개.
//    빼지 않고 **`(묻음)`으로 표시한다** — 채팅의 `·무덤` 표시(2026-07-29)와 같은 처방.
//
// 3. **분모를 데이터가 있는 일수로 나눈다.** 옛 코드는 `prior / 3`으로 고정이었는데 코퍼스가
//    7/16에 시작해 이전 창 21일 중 실데이터가 10일뿐이었다. 빈 11일이 분모에 들어가 주당
//    평균이 반토막 났고, 생존편향과 겹쳐 "네 배"가 나왔다.
//
// 4. **`done` 프로젝트를 빼지 않는다.** 옛 코드의 `.neq('status','done')` 때문에 Caselab이
//    이름조차 재료에 없었다. 그래서 파편 0개를 "침묵"으로 오독했다 — 실제로는 **완료**다.
//    상태와 `created_at`이 이 저장소에서 제일 명시적인 신호인데 그걸 안 읽고 있었다.
//
// 5. **축(관심의 결)을 임베딩 클러스터로 안 잡는다.** 실측 2026-08-01: 임계 0.42에서 축 3개,
//    살아있는 58개 중 9개만 커버(전체의 2.3%). 셋 다 최소 크기 3에 겨우 걸린 것들이었다.
//    파편을 다 주면 모델이 직접 묶는다 — `run.mjs`가 그 결과(refs)로 타임라인을 채운다.
//    그래서 `morning_edges` RPC와 `findAxes`의 rpc 인자는 이제 아무도 안 쓴다.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const ROOT = new URL('../../', import.meta.url);
const MS_PER_DAY = 86_400_000;

// _shared/cluster.ts·vividness.ts와 같은 감쇠 법칙이어야 한다. 세 번째 복제본이라 갈라지기 쉽다 —
// 손댈 땐 `supabase/functions/_shared/cluster.ts`와 나란히 봐라.
export const FLOOR = 0.15;
export const NEAR_FLOOR = 0.7;

const RECENT_DAYS = 7;
const PRIOR_DAYS = 28;
const RHYTHM_DAYS = 14;
const TIMELINE_DAYS = 30;

const FRAG_COLS =
  'id, created_at, content, type, link_title, link_description, note, last_touched_at, tier, touch_count, archived, let_go_at';

export function client() {
  for (const line of readFileSync(new URL('.env', ROOT), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('.env에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  return createClient(url, key);
}

export const kstDate = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const kstTime = (iso) =>
  new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });

export function vividness(fr, now) {
  if (fr.tier === 'pinned') return 1;
  const tier = fr.tier === 'normal' && fr.touch_count >= 2 ? 'important' : fr.tier;
  const [start, floor] = tier === 'important' ? [7, 21] : [1, 7];
  const days = Math.max(0, (now.getTime() - new Date(fr.last_touched_at).getTime()) / MS_PER_DAY);
  if (days <= start) return 1;
  if (days >= floor) return 0.15;
  return 1 - 0.85 * ((days - start) / (floor - start));
}

// §4-B2 지속성 척도. span만 보면 "하루에 몰아 저장 + 한 달 뒤 하나"가 지속으로 잡히므로
// **서로 다른 저장일 3일 이상**을 함께 요구한다 (_shared/cluster.ts shape()와 같은 규칙).
export function shape(dates, now) {
  const t = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const spanDays = (t[t.length - 1] - t[0]) / MS_PER_DAY;
  const quietDays = (now.getTime() - t[t.length - 1]) / MS_PER_DAY;
  const activeDays = new Set(dates.map(kstDate)).size;
  return {
    kind: spanDays >= 21 && activeDays >= 3 ? '지속' : spanDays <= 7 ? '단발' : '중간',
    spanDays: Math.round(spanDays),
    quietDays: Math.round(quietDays),
    activeDays,
  };
}

const titleOf = (f) =>
  ((f.type === 'link' ? (f.link_title ?? f.content) : f.content) ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

const daysAgo = (iso, now) => Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);

export async function buildMorning(sb, now = new Date()) {
  const [fragRes, projRes, mapRes, lastBriefRes] = await Promise.all([
    // ⚠️ archived·let_go를 **안 거른다.** 위 각주 2번. 대신 아래에서 표시한다.
    sb.from('fragments').select(FRAG_COLS).order('created_at', { ascending: false }),
    // ⚠️ done도 가져온다. 위 각주 4번.
    // `*`인 이유: `status_changed_at`(rudy-project-status.sql)이 아직 안 붙은 DB에서도 돌아야 한다.
    // 컬럼이 없으면 undefined가 되고 "이번 주에 상태 바뀜" 표시만 안 뜬다.
    sb.from('projects').select('*').order('created_at'),
    sb.from('fragment_projects').select('fragment_id, project_id'),
    // 어제 한 말 — 오늘 또 하지 않기 위해서만 쓴다. 매일 같은 소리를 하면 사흘이면 안 연다.
    sb.schema('rudy').from('utterances').select('created_at, text')
      .eq('surface', 'briefing').eq('kind', 'pattern')
      .order('created_at', { ascending: false }).limit(3),
  ]);
  if (fragRes.error) throw fragRes.error;
  if (projRes.error) throw projRes.error;

  const rows = fragRes.data ?? [];
  const projects = projRes.data ?? [];
  const nameById = new Map(projects.map((p) => [p.id, p.name]));
  const projectsOf = new Map();
  for (const m of mapRes.data ?? []) {
    const name = nameById.get(m.project_id);
    if (!name) continue;
    projectsOf.set(m.fragment_id, [...(projectsOf.get(m.fragment_id) ?? []), name]);
  }

  const alive = rows.filter((f) => !f.archived && !f.let_go_at);
  const toItem = (f) => ({
    id: f.id,
    title: titleOf(f),
    type: f.type,
    createdAt: f.created_at,
    vividness: vividness(f, now),
    projects: projectsOf.get(f.id) ?? [],
  });

  const todayKey = kstDate(now.toISOString());
  const ydayKey = kstDate(new Date(now.getTime() - MS_PER_DAY).toISOString());
  const today = alive.filter((f) => kstDate(f.created_at) === todayKey).map(toItem);
  const yesterday = alive.filter((f) => kstDate(f.created_at) === ydayKey).map(toItem);

  // 선명도 지형 — 살아있는 것만. "지금 저장소가 얼마나 흐려져 있나"라 묻은 건 대상이 아니다.
  let vivid = 0;
  let fadingN = 0;
  let sunk = 0;
  for (const f of alive) {
    const v = vividness(f, now);
    if (v > NEAR_FLOOR) vivid++;
    else if (v > FLOOR) fadingN++;
    else sunk++;
  }

  const recentCut = now.getTime() - RECENT_DAYS * MS_PER_DAY;
  const priorCut = now.getTime() - PRIOR_DAYS * MS_PER_DAY;
  const at = (f) => new Date(f.created_at).getTime();
  const isRecent = (f) => at(f) >= recentCut;
  const isPrior = (f) => at(f) < recentCut && at(f) >= priorCut;

  const recentRows = rows.filter(isRecent);
  const priorRows = rows.filter(isPrior);

  // 각주 3번 — 분모는 **데이터가 실제로 있는 일수**다. 코퍼스 시작 전 빈 날을 나누면 거짓말이 된다.
  const oldest = rows.length ? at(rows[rows.length - 1]) : now.getTime();
  const priorSpanDays = Math.max(1, Math.min(PRIOR_DAYS - RECENT_DAYS, (recentCut - oldest) / MS_PER_DAY));
  const perDayRecent = recentRows.length / RECENT_DAYS;
  const perDayPrior = priorRows.length / priorSpanDays;

  const quietProjects = projects
    .filter((p) => p.status === 'active')
    .map((p) => {
      const mine = alive.filter((f) => (projectsOf.get(f.id) ?? []).includes(p.name));
      const last = mine[0]?.created_at;
      return { name: p.name, days: last ? daysAgo(last, now) : 999, total: mine.length };
    })
    .filter((p) => p.days >= 7)
    .sort((a, b) => b.days - a.days);

  const perDay = new Map();
  for (const f of alive) perDay.set(kstDate(f.created_at), (perDay.get(kstDate(f.created_at)) ?? 0) + 1);
  const rhythm = Array.from({ length: RHYTHM_DAYS }, (_, offset) => ({
    offset,
    count: perDay.get(kstDate(new Date(now.getTime() - offset * MS_PER_DAY).toISOString())) ?? 0,
  }));

  const fading = alive
    .filter((f) => {
      const v = vividness(f, now);
      return v > FLOOR && v <= NEAR_FLOOR;
    })
    .map(toItem)
    .sort((a, b) => a.vividness - b.vividness)
    .slice(0, 8);

  const nudgeCandidates = alive
    .filter((f) => f.touch_count === 0 && vividness(f, now) <= FLOOR)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((f) => ({ id: f.id, title: titleOf(f), days: daysAgo(f.created_at, now) }));

  // ── 경향. 살아있는 것과 전량을 **둘 다** 낸다 — 그 둘의 차이가 곧 "무엇을 정리했나"다.
  const countBy = (list, key) => {
    const m = new Map();
    for (const f of list) m.set(key(f), (m.get(key(f)) ?? 0) + 1);
    return m;
  };
  const tRecent = countBy(recentRows, (f) => f.type);
  const tPrior = countBy(priorRows, (f) => f.type);
  const types = [...new Set([...tRecent.keys(), ...tPrior.keys()])].map((type) => ({
    type,
    recent: tRecent.get(type) ?? 0,
    prior: tPrior.get(type) ?? 0,
  }));

  const hostOf = (f) => {
    if (f.type !== 'link') return null;
    const m = (f.content ?? '').match(/^https?:\/\/(?:www\.)?([^/?#]+)/i);
    return m ? m[1].toLowerCase() : null;
  };
  const hostCount = new Map();
  for (const f of rows.filter((x) => at(x) >= priorCut)) {
    const h = hostOf(f);
    if (h) hostCount.set(h, (hostCount.get(h) ?? 0) + 1);
  }
  const domains = [...hostCount.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const shareOf = (list) => {
    const m = new Map();
    for (const f of list) for (const n of projectsOf.get(f.id) ?? []) m.set(n, (m.get(n) ?? 0) + 1);
    return m;
  };
  const sRecent = shareOf(recentRows);
  const sPrior = shareOf(priorRows);
  const projectShare = [...new Set([...sRecent.keys(), ...sPrior.keys()])]
    .map((name) => ({ name, recent: sRecent.get(name) ?? 0, prior: sPrior.get(name) ?? 0 }))
    .sort((a, b) => b.recent - a.recent || b.prior - a.prior);

  const stats = {
    today,
    yesterday,
    axes: [], // run.mjs가 모델 출력(refs)으로 채운다
    bands: [
      { label: '또렷함', count: vivid },
      { label: '흐려지는 중', count: fadingN },
      { label: '바닥', count: sunk },
    ],
    quietProjects,
    rhythm,
    fading,
    nudgeCandidates,
    totals: { alive: alive.length, fading: fadingN, sunk },
    trends: {
      volume: {
        recent: recentRows.length,
        prior: priorRows.length,
        priorPerWeek: Math.round(perDayPrior * 7 * 10) / 10,
      },
      domains,
      types,
      projectShare,
    },
  };

  // ── 모델용 재료. 번호(#N)로 참조한다 — UUID를 다 실으면 재료의 상당량을 UUID가 먹는다
  //    (discover-claude/material.mjs가 실측으로 겪은 문제). run.mjs가 번호를 id로 되돌린다.
  const refs = []; // index 0 = #1
  const line = (f, { full = false } = {}) => {
    refs.push(f.id);
    const n = refs.length;
    const pr = (projectsOf.get(f.id) ?? []).join(',');
    const mark = f.archived ? '(묻음)' : f.let_go_at ? '(흘려보냄)' : '';
    const head = `#${n} ${kstDate(f.created_at)}${full ? ` ${kstTime(f.created_at)}` : ''} [${f.type}]${pr ? `{${pr}}` : ''}${mark}`;
    const title = f.type === 'link' && f.link_title ? `『${f.link_title}』 ` : '';
    const body = (f.content ?? '').replace(/\s+/g, ' ').trim().slice(0, full ? 400 : 140);
    const desc = full && f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 200)}` : '';
    const note = f.note ? ` (덧: ${f.note.replace(/\s+/g, ' ').slice(0, full ? 400 : 100)})` : '';
    return `${head} ${title}${body}${desc}${note}`;
  };

  const isThisWeek = (iso) => new Date(iso).getTime() >= recentCut;
  const projLine = (p) => {
    const flags = [
      isThisWeek(p.created_at) ? '★이번 주에 새로 만듦' : '',
      p.status_changed_at && isThisWeek(p.status_changed_at) ? `★이번 주에 ${p.status}로 바뀜` : '',
    ].filter(Boolean);
    const mine = rows.filter((f) => (projectsOf.get(f.id) ?? []).includes(p.name));
    return `- ${p.name} (${p.status}) — ${p.description?.replace(/\s+/g, ' ') ?? '설명 없음'} · 파편 ${mine.length}개(최근 7일 ${mine.filter(isRecent).length}개) · 만든 날 ${kstDate(p.created_at)}${flags.length ? ` · ${flags.join(' · ')}` : ''}`;
  };

  const lastBriefs = (lastBriefRes.data ?? [])
    .map((r) => {
      try {
        const p = JSON.parse(r.text);
        return `- ${kstDate(r.created_at)}: ${p.headline ?? ''}${p.pattern?.text ? ` / 패턴(${p.pattern.kind ?? ''}): ${p.pattern.text.slice(0, 120)}` : ''}`;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const todayRows = rows.filter((f) => kstDate(f.created_at) === todayKey);
  const ydayRows = rows.filter((f) => kstDate(f.created_at) === ydayKey);
  const weekRows = recentRows.filter((f) => !todayRows.includes(f) && !ydayRows.includes(f));

  const md = [
    `# 오늘 ${todayKey}`,
    '',
    '## 지난 브리핑에서 이미 한 말 — 오늘 또 하지 마라',
    lastBriefs.length ? lastBriefs.join('\n') : '(없음 — 첫 브리핑이다)',
    '',
    '## 이 사람이 하고 있는 일',
    '※ 설명이 정답지다. 이름만 보고 넘겨짚지 마라. **상태(active/paused/done/before)와 만든 날이 신호다** —',
    '   파편이 0개인 게 침묵인지 완료인지는 상태가 정한다.',
    projects.map(projLine).join('\n') || '(없음)',
    '',
    `## 오늘 던진 것 (${todayRows.length}개)`,
    todayRows.map((f) => line(f, { full: true })).join('\n') || '(아직 없음)',
    '',
    `## 어제 던진 것 (${ydayRows.length}개)`,
    ydayRows.map((f) => line(f, { full: true })).join('\n') || '(없음)',
    '',
    `## 최근 7일의 나머지 (${weekRows.length}개)`,
    '※ (묻음)은 **버린 게 아니라 정리한 것**이다. 이 사람은 아이디어를 넣어두고 한 번 훑으며 묻는다.',
    '   그래서 "무엇을 남겼나"보다 "무엇을 묻었나"가 더 많은 걸 말해줄 때가 있다.',
    weekRows.map((f) => line(f)).join('\n') || '(없음)',
    '',
    `## 그 앞 ${Math.round(priorSpanDays)}일 (${priorRows.length}개)`,
    priorRows.map((f) => line(f)).join('\n') || '(없음)',
    '',
    '## 숫자 (전부 코드가 셌다 — 다시 세지 마라)',
    `- 저장: 최근 7일 ${recentRows.length}개(하루 ${perDayRecent.toFixed(1)}) / 그 앞 ${Math.round(priorSpanDays)}일 ${priorRows.length}개(하루 ${perDayPrior.toFixed(1)})`,
    `- 그중 묻은 것: 최근 ${recentRows.filter((f) => f.archived).length} / 이전 ${priorRows.filter((f) => f.archived).length}`,
    `- 살아있는 파편 ${alive.length}개 = 또렷함 ${vivid} / 흐려지는 중 ${fadingN} / 바닥 ${sunk}  (전체 저장 ${rows.length}개)`,
    `- 형태(전량): ${types.map((t) => `${t.type} 최근 ${t.recent}/이전 ${t.prior}`).join(', ')}`,
    domains.length ? `- 링크 출처: ${domains.map((d) => `${d.host} ${d.count}`).join(', ')}` : '',
    `- 프로젝트별 저장(전량, 최근/이전): ${projectShare.map((p) => `${p.name} ${p.recent}/${p.prior}`).join(', ') || '(없음)'}`,
    quietProjects.length
      ? `- 진행 중인데 조용한 프로젝트: ${quietProjects.map((p) => `${p.name} ${p.days}일째`).join(', ')}`
      : '- 진행 중인데 조용한 프로젝트: 없음',
    '',
    '## 흐려지는 중 — 아직 바닥은 아니라 지금이 마지막 기회인 것들',
    fading.map((it) => `- ${it.title}`).join('\n') || '(없음)',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return {
    md,
    stats,
    refs,
    // run.mjs가 모델이 낸 refs로 축을 조립할 때 쓴다 (선명도·시간모양 계산에 원본 행이 필요하다).
    rowById: new Map(rows.map((f) => [f.id, f])),
    toItem,
    meta: {
      total: rows.length,
      alive: alive.length,
      today: todayRows.length,
      yesterday: ydayRows.length,
      recent: recentRows.length,
      prior: priorRows.length,
      projects: projects.length,
      chars: md.length,
    },
  };
}

// 넛지 후보 고르기 (§4-A3). 30일 안에 이미 물어본 파편은 다시 안 묻는다 —
// 매일 같은 걸 물으면 그게 잔소리다. 질문 문장은 **모델이 안 쓴다, 여기서 만든다.**
export async function pickNudge(sb, candidates, now) {
  if (!candidates.length) return null;
  const since = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();
  const { data } = await sb.schema('rudy').from('utterances')
    .select('item_ids').eq('kind', 'nudge').gte('created_at', since);
  const asked = new Set((data ?? []).flatMap((r) => r.item_ids ?? []));
  const target = candidates.find((c) => !asked.has(c.id));
  if (!target) return null;
  return { fragmentId: target.id, question: `${target.days}일째 한 번도 안 건드렸어. 버릴까, 진짜 할까?` };
}

export { TIMELINE_DAYS, RECENT_DAYS, PRIOR_DAYS, MS_PER_DAY };
