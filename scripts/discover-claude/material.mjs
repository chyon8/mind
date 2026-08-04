// 클코 발견 — 재료 로드 (RUDY-DISCOVERY.md §2 원리 B: 성격별로 갈라 읽는다).
//
// ⚠️ **기존 파이프라인을 안 건드린다** (유저 지시 2026-07-29). `discovery/material.ts`도
//    `scripts/_discovery-lib.mjs`도 수정하지 않는다 — 여기 따로 읽는다.
//    대신 그쪽과 갈라지면 안 되는 규칙은 그대로 옮겼다:
//      · `done` 프로젝트는 재료에서 제외 (`paused`는 남긴다 — 다시 시작 가능)
//      · 구획 3분리, **lists 구획에 "프로젝트"라는 단어를 쓰지 않는다** (라벨이 캡 소속을 정한다)
//      · `discover_next`(유저 지정)는 창·archived를 무시하고 맨 위에
//      · `fragLine`에 파편 id를 안 싣는다 (UUID가 재료의 28%를 먹었다). URL은 남긴다
//    ✅ `discover_skip`을 반영한다 (2026-07-31부터 `_discovery-lib.mjs`도 동기화됨).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const ROOT = new URL('../../', import.meta.url);
const WINDOW_DAYS = 90;
const FRAG_COLS =
  'id, created_at, type, content, link_title, link_description, note, discover_next_slot';

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

const kstDate = (iso) =>
  new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD

function fragLine(f) {
  const title = f.type === 'link' && f.link_title ? `『${f.link_title}』 ` : '';
  const body = (f.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const desc = f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 120)}` : '';
  const note = f.note ? ` (덧: ${f.note.replace(/\s+/g, ' ').slice(0, 80)})` : '';
  return `  - ${kstDate(f.created_at)} [${f.type}] ${title}${body}${desc}${note}`;
}

export async function buildMaterial(sb) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [projRes, fragRes, mapRes, pickRes, briefRes, linkRes] = await Promise.all([
    sb.from('projects').select('id, name, status, description, discover_skip').order('created_at'),
    sb.from('fragments').select(FRAG_COLS)
      .eq('archived', false).eq('discover_skip', false)
      .gte('created_at', since).order('created_at', { ascending: false }),
    sb.from('fragment_projects').select('fragment_id, project_id'),
    sb.from('fragments').select(FRAG_COLS).eq('discover_next', true).eq('discover_skip', false),
    // 중복 방지는 **힌트만** 넘긴다 (임베딩 게이트는 안 옮겼다 — 반복이 실제로 보이면 그때).
    // 30일 창이 자연 상한이라 무한히 안 자란다. 막는 게 잡는 것보다 싸다.
    sb.schema('rudy').from('utterances').select('text')
      .eq('kind', 'discovery').eq('surface', 'briefing').not('text', 'is', null)
      .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order('created_at', { ascending: false }).limit(60),
    // 이미 저장한 링크 — 저장한 걸 "발견"이라고 되돌려주는 사고를 막는다 (07-28에 실제로 터짐).
    // ⚠️ **무덤(archived)도 일부러 가져온다.** 묻었어도 이 사람이 가진 링크라, 빼면 07-28 사고가
    //    그대로 재발한다(Pushary·TouchGrass가 지금 무덤이다). 대신 `archived`를 같이 읽어
    //    아래에서 `(묻음)`으로 표시한다 — 빼는 게 아니라 표시하는 게 처방이다.
    sb.from('fragments').select('content, link_title, archived').eq('type', 'link')
      .order('created_at', { ascending: false }).limit(300),
  ]);

  // ⚠️ 에러를 표면화한다. 예전엔 전부 `data ?? []`라서 **쿼리가 실패해도 조용히 0건**이 됐다.
  //    특히 지정(`pickRes`)이 0건일 때 "지정이 없는 건지 쿼리가 죽은 건지" 구분이 안 됐다.
  for (const [name, res] of Object.entries({ projRes, fragRes, mapRes, pickRes, briefRes, linkRes })) {
    if (res.error) throw new Error(`재료 로드 실패 (${name}): ${res.error.message}`);
  }

  const projRows = projRes.data ?? [];
  const skipped = new Set(projRows.filter((p) => p.discover_skip).map((p) => p.id));
  const frags = fragRes.data ?? [];
  const fragById = new Map(frags.map((f) => [f.id, f]));

  const byProject = new Map();
  const inProject = new Set();
  const hidden = new Set(); // 제외된 프로젝트 소속 — 미소속으로도 안 새어나간다
  for (const m of mapRes.data ?? []) {
    inProject.add(m.fragment_id);
    if (skipped.has(m.project_id)) hidden.add(m.fragment_id);
    const f = fragById.get(m.fragment_id);
    if (!f) continue;
    byProject.set(m.project_id, [...(byProject.get(m.project_id) ?? []), f]);
  }

  const live = projRows
    .filter((p) => !p.discover_skip && p.status !== 'done')
    .map((p) => ({ ...p, fragments: (byProject.get(p.id) ?? []).filter((f) => !hidden.has(f.id)) }))
    .filter((p) => p.fragments.length > 0);

  const projects = live.filter((p) => p.status === 'active');
  const lists = live.filter((p) => p.status !== 'active');
  const loose = frags.filter((f) => !inProject.has(f.id) && !hidden.has(f.id));
  const picked = pickRes.data ?? [];

  // 최근 브리핑에서 다룬 제목 — `### [라벨] 제목`에서 라벨을 떼고 제목만.
  const topics = (briefRes.data ?? [])
    .flatMap((u) => (u.text ?? '').split('\n'))
    .map((l) => l.match(/^###\s+(?:\[[^\]]+\]\s*)?(.+)$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .slice(0, 250);

  const savedLinks = (linkRes.data ?? [])
    .map((l) => `  - ${l.link_title ?? ''}${l.archived ? ' (묻음)' : ''} ${l.content}`.trim())
    .filter(Boolean);

  const block = (p) =>
    [`[프로젝트: ${p.name}]`, `  설명: ${p.description ?? '(없음)'}`, ...p.fragments.map(fragLine)].join('\n');
  // 지정 파편은 슬롯까지 유저가 골라서 누른다 (2026-08-03) — 모델이 고르는 게 아니다.
  // 앱에서 슬롯 버튼이 생기기 전에 눌린 건 null이라 예전대로 모델에게 맡긴다(사실상 [확장]).
  const pickedLine = (f) =>
    f.discover_next_slot === 'idea'
      ? `${fragLine(f)}\n      → **[아이디어]로 내라.** 이 소재 말고, 이걸 저장한 동기를 채우는 **다른 물건**을 찾아라.`
      : f.discover_next_slot === 'expansion'
        ? `${fragLine(f)}\n      → **[확장]으로 내라.** 이 소재가 가리키는 방향을 더 판다.`
        : fragLine(f);

  const listBlock = (p) =>
    [
      `[${p.name}]${p.status === 'paused' ? ' (paused)' : ''}`,
      ...(p.description ? [`  설명: ${p.description}`] : []),
      ...p.fragments.map(fragLine),
    ].join('\n');

  const md = [
    ...(picked.length
      ? [
          '=== 내가 지정한 것 (유저가 직접 "다음 발견에 포함"을 누른 파편) ===',
          '※ 이건 유저의 명시적 지시다. 반드시 각도로 만들어라.',
          '※ **슬롯도 유저가 눌러서 골랐다. 붙어 있으면 그대로 따라라 — 네가 고르는 게 아니다.**',
          picked.map(pickedLine).join('\n'),
          '',
        ]
      : []),
    '=== 진행 중인 일 (프로젝트) ===',
    '※ 지금 실제로 만들고 있는 것. **설명이 정답지다** — 파편만 보고 넘겨짚지 마라.',
    '※ 여기서 뽑는 각도는 최대 2개까지다.',
    projects.map(block).join('\n\n') || '(없음)',
    '',
    '=== 아이디어·수집함 (아직 시작 안 한 것 / 멈춘 것) ===',
    '※ **이건 프로젝트가 아니라 리스트다.** 파편 하나하나가 내용 그 자체고,',
    '   설명은 정답지가 아니라 그냥 라벨이다. 진행 중인 일의 캡에 걸리지 않는다.',
    '※ 글감은 에세이 소재다 — 프로덕트처럼 다루지 마라.',
    lists.map(listBlock).join('\n\n') || '(없음)',
    '',
    '=== 어디에도 안 묶인 파편 (북마크·관찰·스치는 생각) ===',
    '※ 저장한 링크가 여기 많다. 프로젝트 설명과 겹쳐 봐라 (원리 C).',
    loose.map(fragLine).join('\n') || '(없음)',
    '',
    '=== 이미 다룬 주제 (지난 30일 브리핑 제목) — 반복 금지 ===',
    '※ 여기 있는 것과 같은 얘기를 또 하지 마라.',
    '※ ⚠️ 이건 **막는 목록이지 재료가 아니다.** 여기서 출발점을 고르지 마라.',
    topics.map((t) => `  - ${t}`).join('\n') || '(없음)',
    '',
    '=== 이미 저장한 링크 — "발견"이라고 되돌려주지 마라 ===',
    '※ 이 사람이 이미 아는 것이다. 그리고 **여기 있는 제품의 공식 사이트를 목적지로 삼지 마라**',
    '   (Product Hunt에서 저장한 걸 그 제품 홈페이지로 다시 물어오는 사고가 실제로 났다).',
    '※ ⚠️ 이건 **막는 목록이지 재료가 아니다.** 여기서 출발점을 고르지 마라.',
    '※ `(묻음)`은 이 사람이 손으로 묻은 것이다 — 지금 관심사가 아니다.',
    '   **"저장해둔 X"처럼 현재형으로 부르지 마라.** 막는 데만 쓴다.',
    savedLinks.join('\n') || '(없음)',
  ].join('\n');

  return {
    md,
    stats: {
      projects: projects.length, lists: lists.length, loose: loose.length,
      picked: picked.length, topics: topics.length, savedLinks: savedLinks.length,
      skippedProjects: skipped.size,
    },
  };
}
