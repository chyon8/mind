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

// ── 앞을 보는 카드들 (2026-08-14). 위쪽은 전부 "어제까지 뭐가 있었나"인데 이건 "지금 뭘 하나"다.
// 창이 다르다: 오늘·어제로는 프로젝트별로 쪼갰을 때 남는 게 없어서 판단이 안 선다.
const AHEAD_DAYS = 14;
// 묻지도 흘려보내지도 않고 이만큼 남았으면 "결정을 미룬 것"으로 본다. 이 사람은 훑으면서
// 정리하는 습관이 있어서(각주 2) 이 목록이 저절로 짧게 유지된다 — 실측 2026-08-14에 3개였다.
const FLOAT_DAYS = 7;

const FRAG_COLS =
  'id, created_at, content, type, link_title, link_description, note, note_at, ' +
  'last_touched_at, tier, touch_count, archived, archived_at, let_go_at';

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
  const [fragRes, projRes, mapRes, lastBriefRes, revisitRes, crossRes] = await Promise.all([
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
    // ①⑥의 임베딩 하부 (rudy-morning.sql). 3072차원 쌍 비교라 벡터가 있는 자리에서 돈다.
    sb.schema('rudy').rpc('revisits', { recent_days: RECENT_DAYS, gap_days: 21, min_sim: 0.42, max_rows: 12 }),
    sb.schema('rudy').rpc('cross_project_pairs', { min_sim: 0.45, min_gap_days: 14, max_rows: 12 }),
  ]);
  if (fragRes.error) throw fragRes.error;
  if (projRes.error) throw projRes.error;
  // RPC는 없어도 브리핑이 돌아야 한다 — rudy-morning.sql을 아직 안 붙여넣었을 수 있다.
  // 나머지 카드는 멀쩡한데 전체가 죽으면 그날 아침이 통째로 없어진다.
  for (const [what, res] of [['revisits', revisitRes], ['cross_project_pairs', crossRes]]) {
    if (res.error) console.warn(`[morning] rudy.${what} 없음 — 해당 카드 생략 (${res.error.message})`);
  }

  const rows = fragRes.data ?? [];
  const rowById = new Map(rows.map((f) => [f.id, f]));
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

  // ═══ 앞을 보는 카드들 ═══
  const aheadCut = now.getTime() - AHEAD_DAYS * MS_PER_DAY;
  const isAhead = (f) => at(f) >= aheadCut;

  // ① 돌아온 것 — 묻었는데 몇 주 뒤에 또 던진 것. 짝으로 낸다.
  const revisits = (revisitRes.data ?? [])
    .map((r) => {
      const cur = rows.find((f) => f.id === r.recent_id);
      const past = rows.find((f) => f.id === r.past_id);
      return cur && past
        ? { now: toItem(cur), then: toItem(past), similarity: r.similarity, gap: r.gap, thenBuried: r.past_archived }
        : null;
    })
    .filter(Boolean);

  // ③ 다음 한 수 — 지금 제일 뜨거운 프로젝트. 다음 단계는 **모델이 지어내지 않고 파편에서 찾는다.**
  // done은 후보에서 뺀다 (끝난 걸 두고 "다음"을 물으면 그게 잔소리다).
  const heat = projects
    .filter((p) => p.status !== 'done')
    .map((p) => ({ p, n: rows.filter((f) => isAhead(f) && (projectsOf.get(f.id) ?? []).includes(p.name)).length }))
    .sort((a, b) => b.n - a.n);
  // 3개 미만이면 "뜨겁다"고 부를 게 없다. 억지로 1등을 뽑느니 카드를 안 낸다.
  const hot = heat.filter((h) => h.n >= 3).slice(0, 2).map((h) => h.p.name);

  // ④ 일 말고 — 밀도 상위 프로젝트 **밖에** 있는 최근 파편. 이름을 코드에 박지 않는다:
  // 유저가 프로젝트를 새로 만들면 뭐가 "일"인지도 같이 움직여야 한다.
  //
  // ⚠️ **무소속 링크는 뺀다.** 안 빼면 120개가 오는데 그중 40개가 레딧·ProductHunt 인박스
  //    유입이라 목록이 개발 링크로 도배된다(실측 2026-08-14). 반대로 프로젝트로 좁히면
  //    34개로 줄지만 "독서모임", "음악 루틴", "조용한 곳에 가서 쉬고 싶다" 같은
  //    **직접 쓴 생각이 통째로 날아간다** — 이 사람은 삶 쪽을 대개 무소속 텍스트로 던진다.
  //    그래서 자른 선이 "링크냐 아니냐"다: 유입은 빼고 직접 쓴 건 남긴다.
  const offWork = rows
    .filter(
      (f) =>
        isAhead(f) &&
        !(projectsOf.get(f.id) ?? []).some((n) => hot.includes(n)) &&
        ((projectsOf.get(f.id) ?? []).length > 0 || f.type !== 'link'),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  // ⑥ 안 이어본 연결 — 손으로 나눈 칸을 넘어 붙는 쌍.
  const crossLinks = (crossRes.data ?? [])
    .map((r) => {
      const x = rows.find((f) => f.id === r.a);
      const y = rows.find((f) => f.id === r.b);
      return x && y ? { a: toItem(x), b: toItem(y), similarity: r.similarity, gap: r.gap } : null;
    })
    .filter(Boolean);

  // ② 떠 있는 것 — 하지도 묻지도 않은 채 남은 것. 코드가 끝까지 계산한다(모델 없이 완결).
  const floating = alive
    .filter((f) => daysAgo(f.created_at, now) >= FLOAT_DAYS)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((f) => ({ ...toItem(f), days: daysAgo(f.created_at, now) }));

  // ⑧ 처분 패턴 — 흘려보내기는 명시적 거부다. 프로젝트별 비율이 "뭘 포기했나"를 말한다.
  // 실측 2026-08-14: No phone이 status=active인데 21개 중 17개(81%)가 흘려보냄이었다.
  const disposal = projects
    .map((p) => {
      const mine = rows.filter((f) => (projectsOf.get(f.id) ?? []).includes(p.name));
      const letGo = mine.filter((f) => f.let_go_at).length;
      return {
        name: p.name,
        status: p.status,
        total: mine.length,
        alive: mine.filter((f) => !f.archived && !f.let_go_at).length,
        letGo,
        letGoPct: mine.length ? Math.round((letGo / mine.length) * 100) : 0,
      };
    })
    .filter((d) => d.total >= 5) // 표본이 작으면 비율이 거짓말을 한다
    .sort((a, b) => b.letGoPct - a.letGoPct);

  // 소화 속도 — 던지고 며칠 만에 묻었나. archived_at을 2026-08-14에 붙였으므로
  // 그 전 데이터는 영영 없다. 표본이 찰 때까지 조용히 비워둔다(지어내지 않는다).
  const digestGaps = rows
    .filter((f) => f.archived_at)
    .map((f) => (new Date(f.archived_at).getTime() - at(f)) / MS_PER_DAY)
    .sort((a, b) => a - b);
  const digestion = digestGaps.length >= 5
    ? { n: digestGaps.length, medianDays: Math.round(digestGaps[Math.floor(digestGaps.length / 2)] * 10) / 10 }
    : null;

  // 덧붙임이 "며칠 뒤에 돌아와서 쓴 것"인가 — note_at도 같은 날 붙였다. 같은 이유로 조용히 비운다.
  const returnGaps = rows
    .filter((f) => f.note_at)
    .map((f) => (new Date(f.note_at).getTime() - at(f)) / MS_PER_DAY);
  const returns = returnGaps.length >= 5
    ? { n: returnGaps.length, laterThanADay: returnGaps.filter((d) => d >= 1).length }
    : null;

  // 서사 재료 — 화면엔 안 그린다. 긴 글이 시간 축을 말할 때만 쓴다.
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const weekday = WD.map((label) => ({ label, count: 0 }));
  const hourBand = [
    { label: '새벽 5-9', from: 5, to: 9, count: 0 },
    { label: '오전 9-12', from: 9, to: 12, count: 0 },
    { label: '낮 12-18', from: 12, to: 18, count: 0 },
    { label: '저녁 18-23', from: 18, to: 23, count: 0 },
    { label: '심야 23-5', from: 23, to: 29, count: 0 },
  ];
  for (const f of rows) {
    const kst = new Date(new Date(f.created_at).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    weekday[kst.getDay()].count++;
    const h = kst.getHours();
    const b = hourBand.find((x) => (h >= x.from && h < x.to) || (x.to > 24 && (h >= x.from || h < x.to - 24)));
    if (b) b.count++;
  }

  const ahead = { revisits, hot, floating, crossLinks, disposal, digestion, returns, weekday, hourBand };

  const stats = {
    today,
    yesterday,
    ahead,
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
  // 같은 파편이 여러 구획에 나와도 번호는 하나다 — 아래 "앞을 보는 카드들"이 위 목록의 파편을
  // 다시 가리키는데, 거기서 새 번호를 주면 모델이 같은 것을 둘로 세게 된다.
  const numOf = new Map();
  const line = (f, { full = false } = {}) => {
    let n = numOf.get(f.id);
    if (!n) {
      refs.push(f.id);
      n = refs.length;
      numOf.set(f.id, n);
    }
    const pr = (projectsOf.get(f.id) ?? []).join(',');
    const mark = f.archived ? '(묻음)' : f.let_go_at ? '(흘려보냄)' : '';
    const head = `#${n} ${kstDate(f.created_at)}${full ? ` ${kstTime(f.created_at)}` : ''} [${f.type}]${pr ? `{${pr}}` : ''}${mark}`;
    const title = f.type === 'link' && f.link_title ? `『${f.link_title}』 ` : '';
    const body = (f.content ?? '').replace(/\s+/g, ' ').trim().slice(0, full ? 400 : 140);
    const desc = full && f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 200)}` : '';
    const note = f.note ? ` (덧: ${f.note.replace(/\s+/g, ' ').slice(0, full ? 400 : 100)})` : '';
    return `${head} ${title}${body}${desc}${note}`;
  };

  // 아래 카드 구획에서 위 목록의 파편을 가리킬 때 쓰는 짧은 꼴. 본문을 또 싣지 않는다 —
  // 재료가 두 배가 되고, 같은 걸 두 번 읽은 모델은 그걸 두 번 일어난 일로 읽는다.
  // 위 목록에 없는 것도 있다 — ①의 과거 짝은 28일 창 밖일 수 있다. 그땐 여기서 번호를 준다.
  const ref = (f) => {
    let n = numOf.get(f.id);
    if (!n) {
      refs.push(f.id);
      n = refs.length;
      numOf.set(f.id, n);
    }
    const pr = (projectsOf.get(f.id) ?? []).join(',');
    const mark = f.archived ? '(묻음)' : f.let_go_at ? '(흘려보냄)' : '';
    return `#${n} ${kstDate(f.created_at)}${pr ? `{${pr}}` : ''}${mark} ${titleOf(f)}`;
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

  // 서사는 갱신되는 문서라 **직전 것 하나만** 준다 (패턴은 반복 방지용이라 3개를 주는 것과 다르다).
  // 세 개를 주면 모델이 셋을 합치려 들고, 그러면 갱신이 아니라 요약이 된다.
  const lastNarrative = (() => {
    for (const r of lastBriefRes.data ?? []) {
      try {
        const n = JSON.parse(r.text)?.narrative;
        if (!n?.paras?.length) continue;
        return [
          `(${kstDate(r.created_at)}에 쓴 것)`,
          ...n.paras.map((p) => `[${p.confidence ?? '추측'}] ${p.text}`),
          n.counter ? `반증으로 적어둔 것: ${n.counter}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      } catch {
        // 옛 형식이면 서사가 없다 — 다음 것을 본다
      }
    }
    return null;
  })();

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
    '',
    '# ═══ 앞을 보는 재료 ═══',
    '※ 여기부터는 "어제까지 뭐가 있었나"가 아니라 "지금 뭘 하나"다. 위 구획과 섞지 마라.',
    '※ 아래 숫자·짝은 **전부 코드가 계산했다.** 다시 세지도, 다른 짝을 지어내지도 마라.',
    '',
    '## ① 돌아온 것 — 몇 주 전에 던지고 정리한 걸 최근에 또 던졌다',
    '※ 한 번 던진 건 충동이고 몇 주 뒤에 또 던진 건 의지다. 그 차이가 이 카드의 전부다.',
    '   과거 짝이 (묻음)인 게 정상이다 — 정리했는데도 돌아왔다는 뜻이라 오히려 신호가 세다.',
    revisits.length
      ? revisits
          .map((r) => {
            const cur = rowById.get(r.now.id);
            const past = rowById.get(r.then.id);
            return `- 유사도 ${r.similarity.toFixed(2)} · ${r.gap}일 만에\n  지금: ${ref(cur)}\n  그때: ${ref(past)}`;
          })
          .join('\n')
      : '(없음)',
    '',
    `## ③ 다음 한 수 — 지금 제일 뜨거운 것: ${hot.length ? hot.map((n) => `${n}(최근 ${AHEAD_DAYS}일 ${heat.find((h) => h.p.name === n).n}개)`).join(', ') : '(없음 — 어디도 3개를 못 넘겼다)'}`,
    '※ 이 프로젝트 파편은 위 목록에 이미 있다. 거기서 이 사람이 직접 적어둔 다음 단계를 찾아라 —',
    '   "다음엔 ~", "일단 ~", "~부터", "mvp", "~해볼까" 같은 게 붙은 파편이 있으면 그게 출발점이다.',
    '※ **찾은 걸 그대로 읊고 끝내지 마라.** "적어놓고 안 했다"는 관찰이고, 이 카드는 제안이다.',
    '   거기서 한 걸음 나아간 행동을 하나 내라. **오늘 앉은자리에서 끝나는 크기로 쪼개서.**',
    '   없는 사실을 지어내는 건 금지지만, 있는 것에서 한 걸음은 네가 내는 게 맞다.',
    '',
    `## ④ 일 말고 — 위 프로젝트 밖의 최근 ${AHEAD_DAYS}일 파편`,
    '※ 만드는 것 말고 사는 것 쪽이 여기 있다(가고 싶은 곳·음악·글·몸·사람). 이쪽은 파편 수가',
    '   적어서 위 구획에선 항상 개발에 밀린다. 자리를 따로 준 이유가 그거다.',
    '   개발·앱 얘기가 섞여 있으면 그건 빼라. 남는 게 없으면 없는 거다.',
    offWork.length ? offWork.map((f) => `- ${ref(f)}`).join('\n') : '(없음)',
    '',
    '## ⑥ 안 이어본 연결 — 다른 프로젝트에 넣어뒀는데 사실 같은 얘기',
    '※ 프로젝트는 이 사람이 손으로 나눈 칸이다. 그 칸을 넘어 붙는 쌍만 골라뒀다.',
    '   "둘이 비슷하다"고만 쓰면 값이 없다. **붙였을 때 뭐가 되는지**를 한 줄로 써라.',
    crossLinks.length
      ? crossLinks
          .map((c) => `- 유사도 ${c.similarity.toFixed(2)} · ${c.gap}일 차\n  ${ref(rowById.get(c.a.id))}\n  ${ref(rowById.get(c.b.id))}`)
          .join('\n')
      : '(없음)',
    '',
    '## ② 떠 있는 것 — 하지도 묻지도 않은 채 남은 것 (코드가 끝냈다. 화면이 그대로 그린다)',
    '※ 여기에 쓰지 마라. 서사에서 근거로만 써라.',
    floating.length ? floating.map((it) => `- ${it.days}일째 ${it.title}`).join('\n') : '(없음)',
    '',
    '## 서사 전용 재료 — 위 카드엔 쓰지 마라',
    `- 요일별 저장: ${weekday.map((w) => `${w.label} ${w.count}`).join(' · ')}`,
    `- 시간대별 저장: ${hourBand.map((h) => `${h.label} ${h.count}`).join(' · ')}`,
    `- 처분(흘려보내기 = 명시적 거부): ${disposal.map((d) => `${d.name}(${d.status}) ${d.letGoPct}% 흘려보냄·살아있는 것 ${d.alive}/${d.total}`).join(' · ') || '(표본 부족)'}`,
    digestion
      ? `- 소화 속도: 던지고 묻기까지 중앙값 ${digestion.medianDays}일 (표본 ${digestion.n}개)`
      : '- 소화 속도: 아직 표본이 없다 (기록을 2026-08-14에 시작했다). 이 축은 말하지 마라.',
    returns
      ? `- 덧붙임: ${returns.n}개 중 ${returns.laterThanADay}개가 하루 이상 지나서 붙었다 (= 되돌아왔다)`
      : '- 덧붙임 시각: 아직 표본이 없다 (2026-08-14 시작). 이 축은 말하지 마라.',
    '',
    '## 지난 서사 — 이걸 고쳐 쓴다. 처음부터 새로 쓰지 마라',
    '※ 서사는 매일 새로 쓰는 글이 아니라 **하나의 문서를 계속 갱신하는 것**이다.',
    '   새 파편이 들어오면 그 판단을 수정한다. 지난 판단이 틀렸으면 틀렸다고 적고 고쳐라.',
    '   아무것도 안 바뀌었으면 그대로 두고 `changed`를 null로 둬라 — 억지로 고치지 마라.',
    lastNarrative ?? '(없음 — 이번이 첫 서사다. 처음부터 쓴다.)',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return {
    md,
    stats,
    refs,
    // run.mjs가 모델이 낸 refs로 축을 조립할 때 쓴다 (선명도·시간모양 계산에 원본 행이 필요하다).
    rowById,
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
