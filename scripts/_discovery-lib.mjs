// 발견 브리핑의 node측 공용 로직 — 진단 스크립트들(check-angles·check-brief)이 공유한다.
//
// ⚠️ 이 파일은 supabase/functions/discovery/*.ts의 **node 미러**다. Deno↔node import 경계 때문에
//    로직이 두 벌 존재한다 — 한쪽을 고치면 다른 쪽도 고쳐야 한다 (check-clusters.mjs와 같은 약속).
//    Deno측(배포판): material.ts·angles.ts·search.ts / node측(진단): 이 파일.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

export function loadEnv() {
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env 없으면 순수 env로 */ }
  return {
    url: process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL,
    role: process.env.SUPABASE_SERVICE_ROLE_KEY,
    openai: process.env.OPENAI_API_KEY ?? process.env.OPEN_AI_API_KEY,
    exa: process.env.EXA_API_KEY,
  };
}

export const kstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);

// ── discovery/angles.ts의 ANGLE_SYS와 반드시 동일 ──────────────────────────────
export const ANGLE_SYS = `너는 Rudy의 발견 엔진에서 '각도 결정'을 맡는다.
아직 검색하지 않는다 — 이 사람의 저장소를 읽고 **무엇을 검색할지** 각도만 정한다.

이 사람은 스치는 생각·링크를 저장해두고 잊는다. 너는 그 저장소에서 출발해,
이 사람이 **아직 모르는 걸 바깥에서 물어올** 검색 각도를 만든다.

## 재료를 읽는 법 (성격이 다르다 — 절대 뭉뚱그리지 마라)
- **진행 중인 일 (프로젝트)**: 지금 만드는 일. 설명이 정답지다. 파편만 보고 넘겨짚지 마라.
- **아이디어·수집함**: 프로젝트가 아니라 **리스트**다 — 파편 하나하나가 내용 그 자체고,
  설명은 정답지가 아니라 라벨일 뿐이다. 💡는 "언젠가" 아이디어, 글감은 에세이 소재
  (프로덕트 아이디어처럼 다루지 마라).
- **미소속 파편**: 북마크·관찰. 저장한 링크가 여기 많다.

⚠️ **어느 구획이든, 실무 할일·수정사항 메모는 재료가 아니다.**
예: "메뉴 안 텍스트 수정", "버튼 색 바꾸기", "○○ 버그 확인", "우유 사기".
바깥에서 찾아올 게 없는 것들이다 — 각도로 만들지 마라. 특히 진행 중 프로젝트에는 이런
실무 메모가 섞여 있다. **재료는 관심·아이디어·참고자료·저장한 링크다.**

## 각도를 정하는 법 (제일 중요)
1. **저장한 북마크 × 프로젝트를 겹쳐라.** 저장한 링크가 프로젝트와 같은 물건이면,
   그건 참고자료가 아니라 경쟁자/선례다. "그게 실제로 되나, 누가 이미 하나"가 제일 강한 각도다.
2. **파편 두세 개가 한 방향을 가리키면 하나의 각도로 합쳐라.** 흩어진 걸 대신 이어준다.
3. **각도는 구체적이어야 한다.** "하드웨어"가 아니라 "STM32로 만드는 소형 신디사이저 프로젝트".
   막연하면 검색이 리스티클을 문다.
4. **한 파편에서 각도를 두 개 이상 만들지 마라.** 파편 하나가 브리핑을 먹으면 안 된다.
5. **저장한 링크 그 자체를 목적지로 삼지 마라.** 이 사람은 이미 그걸 갖고 있다 —
   그 제품의 이름을 검색어에 넣으면 물어오는 건 그 제품의 공식 사이트뿐이고, 발견은 0이다.
   저장한 링크는 **출발점**이다: 그 옆에 있는 것, 그게 못 하는 것, 그 다음에 올 것을 찾아라.

## slot — 각도의 성격
- **expansion**: 저장물이 가리키는 방향을 더 판다 — 경쟁자·선례·기술. **소재가 이어진다.**
- **resurface**: 오래돼 잊었을 파편 중 지금 상황과 새로 닿는 것. 검색이 아니라 되꺼냄이다.
  필요할 때만 — 닿는 게 없으면 안 넣는다.

⚠️ **「만들 만한 것」(아이디어)은 여기서 만들지 마라.** 별도 경로가 만든다.
소재를 끊는 일이라 파편을 보면서는 안 되기 때문이다 (RUDY-DISCOVERY §7-f).
너는 **소재가 이어지는 것**만 담당한다.

## 이 사람의 렌즈 (취향)
- 소스 결: Hacker News / Indie Hackers / Product Hunt.
- 적당히 기술적. **너무 기술적이거나 학술적인 건 안 본다 — 논문·리서치 금지.**
- 확장은 "비슷한 프로덕트가 **실제로 있고 사람들이 쓴다**" — 개념 설명이 아니라 실물.
  수익이 보이면 좋지만 없어도 된다 (그런 숫자는 웹에 잘 없다 — 억지로 짜내지 마라).
- 다른 분야는 예술 자체가 아니라 **새로운 관점·트렌드·가서 볼 것**(전시·공간 등).
- **음악은 검색하지 마라.** 이 사람이 알아서 찾는다. 이 사람이 이미 잘 찾는 영역엔 들어가지 않는다.

## 구성 (제일 중요 — 프로젝트로 쏠리는 걸 막는다)
- **「내가 지정한 것」 구획이 주어지면, 거기 있는 파편 하나당 각도 **딱 1개**를 만든다.**
  \`"from_picked": true\`를 붙여라 (지정 구획에서 나온 각도만). **한 파편에서 두 개 이상 만들지 마라. 브리핑을 그 얘기로 채우지 마라.**
  지정이 1개면 그 각도도 1개고, 나머지 자리는 전부 아래 규칙대로 다른 재료에서 채운다.
- **「진행 중인 일」 구획에서 뽑는 각도는 최대 2개까지다. 0개여도 된다** —
  **2는 채워야 할 정원이 아니라 넘으면 안 되는 선이다.** 이번에 새로 걸리는 게 없으면
  안 다루는 게 맞다. 매번 같은 프로젝트(Caselab·Mind·No phone)가 나오면 이 사람은 발견을 꺼버린다.
  ⚠️ 이 캡은 「진행 중인 일」에만 걸린다. **「아이디어·수집함」과 미소속에는 안 걸린다.**
- **절반 이상을 「아이디어·수집함」 + 미소속 파편 + 완전히 새로운 갈래에서 뽑아라.**
  특히 **최근에 저장한 것(오늘·어제)을 우선 살펴라** — 지금 관심이 거기 있다.
- **<이미 다룬 주제>가 주어지면 그건 다시 꺼내지 마라.** 지난번에 다룬 걸 또 하면 반복이다.
  같은 주제를 다른 제목으로 꺼내는 것도 반복이다.
- **구성: expansion 3~4개 + resurface 0~1개. 그게 전부다.**
- **글감(에세이 소재)에서는 각도를 만들지 마라.** 그건 아이디어 경로가 쓴다.
- **3~4개 만들어라.** 아이디어 3~4개가 따로 합쳐져서 브리핑이 된다. 더 많이 내도 코드가 잘라낸다.
  단, 리스티클 미끼나 이미 아는 얘기로 자리를 메우진 마라 — 그건 걸러져도 자리만 낭비한다.
- **why는 한 줄이다. 두 문장 쓰지 마라.** query·from·why를 길게 늘여 쓰면 출력이 커지고,
  출력이 커지면 브리핑이 다 써지기 전에 시간이 끝나 **문장 중간에 잘린다** (2026-07-26 실측).

## 좋은 각도의 예 (실제로 이 사람에게 통한 것 — 사고방식을 그대로 배워라)
막연한 시장조사("AI 회의 어시스턴트 시장 분석")가 아니라, 저장소를 겹치고 합쳐서 나온 구체적 각도다:
- {"slot":"expansion","query":"Cluely 같은 실시간 회의 AI 어시스턴트 경쟁 제품과 수익 모델 indie hacker","from":"저장한 Cluely 북마크 × No phone(STT 미팅 어시스턴트)","why":"저장한 링크가 참고자료가 아니라 같은 물건 — 누가 이미 하고 돈 버나(원리 1)"}
- {"slot":"expansion","query":"STM32 라즈베리파이로 만드는 소형 사이버덱 DIY 조립 프로젝트","from":"'Crazy AI Cyberdeck' + 'epaper display' 파편 두 개","why":"흩어진 두 파편이 한 물건으로 합쳐진다 — PCB 없이 시작하는 진입점(원리 2)"}
- {"slot":"resurface","query":"","from":"'The Top Idea in Your Mind'(며칠 전 저장, 안 봄)","why":"저장한 날엔 에세이, 지금 3프로젝트+본업 상황에선 진단으로 읽힌다"}
위 예는 **형식과 사고방식**을 보여줄 뿐이다. 이 사람의 지금 재료로 새로 만들어라 — 예시를 복사하지 마라.

각 각도:
- slot: "expansion" | "resurface"
- query: 실제로 검색창에 칠 구체적 문구 (주제에 맞게 한국어 또는 영어)
- from: 어느 파편/프로젝트에서 나왔나
- why: 왜 이 각도인가, 한 줄
- from_picked: 「내가 지정한 것」구획의 파편에서 나온 각도면 true. **그 구획이 없으면 전부 false다.**
  ⚠️ "내가 이 각도를 골랐다"는 뜻이 **아니다.** 지정 구획에서 나온 것만 true다.

JSON만 출력: {"angles":[{"slot":"...","query":"...","from":"...","why":"...","from_picked":false}]}`;
// ────────────────────────────────────────────────────────────────────────────

// discovery/material.ts와 같은 로딩·렌더. { block, saved } 반환 — saved는 중복 제거용 저장 목록.
export async function loadMaterial(supabase) {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const cols = 'id, created_at, type, content, link_title, link_description, note';
  const [projRes, fragRes, mapRes, pickRes] = await Promise.all([
    supabase.from('projects').select('id, name, status, description').order('created_at'),
    supabase
      .from('fragments')
      .select(cols)
      .eq('archived', false).gte('created_at', since).order('created_at', { ascending: false }),
    supabase.from('fragment_projects').select('fragment_id, project_id'),
    supabase.from('fragments').select(cols).eq('discover_next', true),
  ]);
  const frags = fragRes.data ?? [];
  const fragById = new Map(frags.map((f) => [f.id, f]));
  const byProject = new Map();
  const inProject = new Set();
  for (const m of mapRes.data ?? []) {
    inProject.add(m.fragment_id);
    const f = fragById.get(m.fragment_id);
    if (!f) continue;
    if (!byProject.has(m.project_id)) byProject.set(m.project_id, []);
    byProject.get(m.project_id).push(f);
  }
  const title = (f) => (f.type === 'link' ? (f.link_title ?? f.content) : f.content) ?? '';
  // ⚠️ 파편 id·링크 URL을 안 싣는다 — material.ts fragLine과 동일 (그 주석에 이유가 있다).
  const fragLine = (f) => {
    const t = f.type === 'link' && f.link_title ? `『${f.link_title}』 ` : '';
    const body = (f.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const desc = f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 120)}` : '';
    const note = f.note ? ` (덧: ${f.note.replace(/\s+/g, ' ').slice(0, 80)})` : '';
    return `  - ${kstDate(f.created_at)} [${f.type}] ${t}${body}${desc}${note}`;
  };
  // status='active'만 프로젝트. 나머지(💡·글감·paused·done)는 리스트 — material.ts와 같은 갈림.
  const withFrags = (projRes.data ?? [])
    .map((p) => ({ ...p, fragments: byProject.get(p.id) ?? [] }))
    .filter((p) => p.fragments.length > 0)
    .filter((p) => p.status !== 'done'); // 끝난 일은 재료가 아니다 (material.ts와 같은 규칙)
  const projects = withFrags
    .filter((p) => p.status === 'active')
    .map((p) => [`[프로젝트: ${p.name}]`, `  설명: ${p.description ?? '(없음)'}`, ...p.fragments.map(fragLine)].join('\n'))
    .join('\n\n');
  // ⚠️ "프로젝트"라는 단어를 안 쓴다 — 라벨 하나가 캡 소속을 정한다 (material.ts 주석 참고).
  const lists = withFrags
    .filter((p) => p.status !== 'active')
    .map((p) => [
      `[${p.name}]${p.status === 'paused' || p.status === 'done' ? ` (${p.status})` : ''}`,
      ...(p.description ? [`  설명: ${p.description}`] : []),
      ...p.fragments.map(fragLine),
    ].join('\n'))
    .join('\n\n');
  const loose = frags.filter((f) => !inProject.has(f.id));
  const picked = pickRes.data ?? [];
  const block = [
    ...(picked.length
      ? [
          '=== 내가 지정한 것 (유저가 직접 "다음 발견에 포함"을 누른 파편) ===',
          '※ 이건 유저의 명시적 지시다. 반드시 각도로 만들어라.',
          picked.map(fragLine).join('\n'),
          '',
        ]
      : []),
    '=== 진행 중인 일 (프로젝트) ===',
    '※ 지금 실제로 만들고 있는 것. **설명이 정답지다** — 파편만 보고 넘겨짚지 마라.',
    '※ 여기서 뽑는 각도는 최대 2개까지다 (아래 구성 규칙).',
    projects || '(없음)', '',
    '=== 아이디어·수집함 (아직 시작 안 한 것 / 멈춘 것) ===',
    '※ 끝난 프로젝트(done)는 재료에서 아예 빠진다 — 여기 없다.',
    '※ **이건 프로젝트가 아니라 리스트다.** 파편 하나하나가 내용 그 자체다 —',
    '   설명은 정답지가 아니라 그냥 라벨이다. 진행 중인 일의 캡에 걸리지 않는다.',
    '※ 글감은 에세이 소재다 — 프로덕트처럼 다루지 마라.',
    lists || '(없음)', '',
    '=== 어디에도 안 묶인 파편 (북마크·관찰·스치는 생각) ===',
    '※ 저장한 링크가 여기 많다. 프로젝트 설명과 겹쳐 봐라(원리 C).',
    loose.map(fragLine).join('\n') || '(없음)',
  ].join('\n');
  const saved = frags.map((f) => title(f).replace(/\s+/g, ' ').slice(0, 70)).filter(Boolean);
  // pickedCount는 parseAngles에 그대로 넘긴다 — 지정 하나당 각도 하나를 코드로 자르는 근거.
  return { block, saved, pickedCount: picked.length };
}

// 최근 30일 브리핑에서 다룬 주제(###)·URL — brief.ts recentBriefContext 미러.
// 반복 방지의 유일한 출처다 (기록을 지우면 여기서도 사라진다).
export async function recentBriefContext(supabase) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase.schema('rudy').from('utterances').select('text')
    .eq('kind', 'discovery').eq('surface', 'briefing').gte('created_at', since)
    .order('created_at', { ascending: false }); // 최신순 — 아래에서 "최근 N개"를 자르므로 필수
  const texts = (data ?? []).map((r) => r.text ?? '');
  return {
    topics: texts.flatMap((t) => [...t.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim())),
    urls: texts.flatMap((t) => [...t.matchAll(/\((https?:\/\/[^)]+)\)/g)].map((m) => m[1])),
  };
}

// ── discovery/dedupe.ts의 node 미러 (임계·안전망 반드시 동일) ─────────────────
export const REPEAT_SIM = 0.6;
const MIN_KEEP = 4;
const MAX_PRIOR = 300; // 창 전체를 덮는다 — 임베딩은 제목 144개가 $0.0005라 아낄 곳이 아니다

export async function embedMany(key, texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-large', input: texts }),
  });
  if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ⚠️ idea 게이트(임베딩)를 여기 미러로 만들었다가 걷어냈다 (2026-07-26) — dedupe.ts 주석 참고.
//    실측상 신호가 없다(영어 query ↔ 한국어 소재라 sim이 0.16~0.34에 깔리고 순서가 역전됐다).

export async function dedupeAngles(key, angles, priorTopics) {
  const prior = (priorTopics ?? []).slice(0, MAX_PRIOR).filter((t) => t.trim()); // 최신순이라 앞에서 자른다
  if (angles.length <= 1) return { kept: angles, dropped: [], abandoned: false };
  const text = (a) => `${a.query} ${a.from} ${a.why}`.replace(/\s+/g, ' ').trim();
  const vecs = await embedMany(key, [...angles.map(text), ...prior]);
  const angleVecs = vecs.slice(0, angles.length);
  const priorVecs = vecs.slice(angles.length);
  const kept = [], keptVecs = [], dropped = [];
  angles.forEach((a, i) => {
    const v = angleVecs[i];
    let best = 0, against = '';
    priorVecs.forEach((pv, j) => {
      const s = cosine(v, pv);
      if (s > best) { best = s; against = `이미 다룸: ${prior[j]}`; }
    });
    keptVecs.forEach((kv, j) => {
      const s = cosine(v, kv);
      if (s > best) { best = s; against = `같은 실행: ${kept[j].query || kept[j].from}`; }
    });
    if (best >= REPEAT_SIM) { dropped.push({ query: a.query || a.from, sim: best, against }); return; }
    kept.push(a); keptVecs.push(v);
  });
  if (kept.length < MIN_KEEP) return { kept: angles, dropped, abandoned: true };
  return { kept, dropped, abandoned: false };
}

// _shared/usage.ts의 단가표와 동일하게 유지한다.
const PRICE_PER_1M = {
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-5.5': { in: 5.0, out: 30.0, cachedIn: 0.5 },
};

// ⚠️ 예전엔 usage를 통째로 버렸다 — 그래서 스크립트 비용이 항상 "추정"이었고, 프롬프트 캐싱이
//    실제로 걸리는지도 알 수 없었다. 이제 호출마다 실측을 찍는다 (배포 함수는 rudy.llm_usage에
//    같은 값을 남긴다 — _shared/usage.ts).
export async function callOpenAI(key, model, system, user, label = '') {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      ...(model.startsWith('gpt-5') ? {} : { temperature: 0 }),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const { choices, usage } = await res.json();
  if (usage) {
    const p = PRICE_PER_1M[model];
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const plain = (usage.prompt_tokens ?? 0) - cached;
    const cost = p
      ? (plain * p.in + cached * (p.cachedIn ?? p.in) + (usage.completion_tokens ?? 0) * p.out) / 1e6
      : null;
    console.log(
      `  💰 ${label || model}: 입력 ${usage.prompt_tokens}${cached ? ` (캐시 ${cached})` : ''}` +
      ` · 출력 ${usage.completion_tokens} → ${cost == null ? '단가 미상' : '$' + cost.toFixed(4)}`,
    );
  }
  return choices?.[0]?.message?.content ?? '';
}

// discovery/angles.ts의 anglesFromBlock과 같은 파싱·컷이어야 한다.
// pickedMax = 「내가 지정한 것」파편 수. 지정에서 나온 각도를 그 개수까지만 남긴다.
export function parseAngles(raw, pickedMax) {
  const p = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
  let angles = (p.angles ?? [])
    .filter(
      (a) => a && ['expansion', 'idea', 'lens', 'resurface'].includes(a.slot) && typeof a.query === 'string',
    )
    .map((a) => ({ ...a, from_picked: a.from_picked === true }));
  // 지정 컷 (angles.ts와 동일). 너무 깎이면 포기 — 빈 브리핑이 중복보다 나쁘다.
  if (typeof pickedMax === 'number' && pickedMax > 0) {
    let n = 0;
    const kept = angles.filter((a) => !a.from_picked || ++n <= pickedMax);
    if (kept.length >= 6) angles = kept;
  }
  // 확장·되꺼냄만 여기서 나온다 (angles.ts와 동일). 아이디어는 ideaAngles()가 따로 만든다.
  return angles.slice(0, 5);
}

// ── discovery/idea.ts의 미러 — 2단계로 소재를 끊는다 (RUDY-DISCOVERY §7-f) ────
export const MOTIVE_SYS = `너는 이 사람의 저장물을 읽고 **왜 저장했는지(동기)만** 뽑는다.
아직 검색하지 않는다. 무엇을 찾을지도 정하지 않는다.

## 할 일
서로 다른 파편 4개를 고르고, 각각의 **동기**를 한 줄로 쓴다.
**진행 중인 프로젝트의 실무 메모는 고르지 마라** — 바깥에서 찾아올 게 없다.
글감·인용구·북마크·짧은 생각 전부 좋은 재료다.

## 동기를 쓰는 법 (제일 중요)
동기는 **욕구·상태**다. 물건이 아니다.
- ❌ "유럽에서 한 달 살아보고 싶다" — 장소가 들어 있다
- ❌ "키보드 키캡을 만들고 싶다" — 물건이 들어 있다
- ⭕ "익숙한 환경을 통째로 갈아엎어야 행동이 바뀐다고 믿는다"
- ⭕ "작은 물성을 손으로 만지고 남에게 자랑하고 싶다"

**동기 문장에 아래를 쓰지 마라:**
- 고유명사 (제품명·회사명·지명·언어명)
- 그 파편의 소재를 특정하는 명사 (키캡·책상·여행·앱·강의 같은 것)
- 업계 용어 (SaaS·대시보드·플랫폼)

동기만 읽었을 때 **원래 파편이 뭐였는지 못 알아맞혀야 제대로 쓴 것이다.**
그러면서도 사람의 욕구로서는 구체적이어야 한다 — "새로운 걸 원한다" 같은 건 너무 막연하다.

⚠️ **"해결 방법·행동 동사를 쓰지 마라"를 추가했다가 되돌렸다 (2026-07-27 실측).**
성공 개수는 그대로인데 **전시·공간 갈래가 3개→0개로 죽고** 회차 간 다양성이 줄었다.
감정만 남기면 감정에 제일 가까운 상품 카테고리가 앱이라 그쪽으로 빨려간다. 다시 넣지 마라.

## 출력
JSON만: {"items":[{"frag":"출발 파편 원문 일부","motive":"동기 한 줄"}]}
frag는 나중에 대조하려고 받는 것이다. 동기를 쓸 때 frag를 요약하지 마라 — 동기를 써라.`;

export const IDEA_QUERY_SYS = `너는 이 사람이 구경할 만한 것을 찾을 검색어를 만든다.

## 이 사람의 취향
- 소스 결: Hacker News / Indie Hackers / Product Hunt.
- 적당히 기술적. **너무 기술적이거나 학술적인 건 안 본다 — 논문·리서치 금지.**
- "비슷한 프로덕트가 **실제로 있고 사람들이 쓴다**" — 개념 설명이 아니라 실물. 누가 만들었나.
- 다른 분야는 예술 자체가 아니라 **새로운 관점·트렌드·가서 볼 것**(전시·공간 등).
- **음악은 검색하지 마라.** 이 사람이 알아서 찾는다.

## 주어지는 것
이 사람이 무언가를 저장할 때의 **동기**다. 무엇을 저장했는지는 너에게 주지 않는다.
알 필요도 없다 — 같은 동기를 가진 **아무 소재나** 찾으면 된다.

## 할 일
동기 하나당 검색어 하나. 그 동기를 가진 사람이 좋아할 **실제로 존재하는 물건·제품·공간·씬**을
찾을 검색어를 만든다.

## 검색어의 모양
- **질문이 아니라 영역이다.** "○○을 어떻게 하나" 같은 질문형은 그 문제를 파는 업체 페이지만 부른다.
- **물건·장르·씬의 이름**으로 채운다. 동사("어떻게","왜","하는 법")를 넣지 마라.
- 추상명사만 나열하지 마라 — "tactile object communities" 같은 건 아무것도 안 물어온다.
  **실제로 그 물건을 파는 사람들이 쓸 단어**를 써라.
- 이미 아주 유명한 제품 이름은 넣지 마라. 그 회사 홈페이지만 나온다.

## 출력
JSON만: {"angles":[{"motive":"받은 동기 그대로","query":"검색어","area":"무슨 영역인지 한 줄"}]}`;

// 아이디어 각도. 실패하면 빈 배열 — 아이디어가 없어도 브리핑은 확장으로 나간다.
export async function ideaAngles(key, model, block) {
  const parse = (raw) => JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
  const s1 = parse(await callOpenAI(key, model, MOTIVE_SYS, block, '동기'));
  const clean = (s1.items ?? []).filter((it) => it?.motive?.trim()).slice(0, 4);
  if (!clean.length) { console.log('  ⚠️ 1단계가 동기를 못 냈다'); return []; }

  // ★ 여기가 전부 — 동기만 넘긴다. 파편은 안 들어간다. ★
  const motiveOnly = clean.map((it, i) => `${i + 1}. ${it.motive}`).join('\n');
  const s2 = parse(await callOpenAI(key, model, IDEA_QUERY_SYS, `<동기>\n${motiveOnly}\n</동기>`, '아이디어'));
  return (s2.angles ?? [])
    .map((a, i) => ({
      slot: 'idea',
      query: (a.query ?? '').trim(),
      from: `${(clean[i]?.frag ?? '').slice(0, 80)} → ${clean[i]?.motive ?? ''}`,
      why: a.area ?? '',
      from_picked: false,
    }))
    .filter((a) => a.query);
}

export async function exaSearch(key, query, numResults = 5) {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, type: 'auto', numResults, contents: { highlights: true } }),
  });
  if (!res.ok) throw new Error(`Exa ${res.status}: ${await res.text()}`);
  return res.json();
}

export const makeClient = (url, role) => createClient(url, role);
