# RUDY-BUILD.md — 개발 착수 스펙 (Phase 0 → A → C)

> RUDY.md가 "무엇을 왜"라면, 이 문서는 **"어떻게, 바로 짤 수 있게"**다.
> 대상 경로: **0(토대) → A(의미 검색) → C(채팅)** + 충돌 회상(B) 설계.
> 실제 스키마(`public.fragments`) 위에 얹는다. 기존 Mind 앱은 건드리지 않고 더한다.

---

## 0. 확정 기술 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 임베딩 모델 | **OpenAI `text-embedding-3-large`, 3072차원** | 유저 지시("최상 퀄리티"). 한국어 성능 최상급 |
| 벡터 검색 | **정확(exact) 코사인, 인덱스 없음** | 유저 1명·파편 수천 개 → 순차 스캔이 밀리초. HNSW는 2000차원 초과 불가라 어차피 3072엔 못 씀. 코퍼스 수만 개 넘으면 그때 차원 축소 + 인덱스 |
| 임베딩 텍스트 | 아래 `embed_text()` 규칙 | 링크 파편은 URL이 아니라 제목·노트로 (유령 파편 방지, RUDY.md §3-2) |
| 스키마 분리 | **`rudy` 스키마** 신설, `public.fragments`는 읽기만 | Mind 데이터 무오염 |
| 정규화 `items` 뷰 | **안 만든다 (YAGNI)** | 소스가 Mind 하나뿐. 캘린더·Things 붙일 때(먼 단계) 도입 |
| 임베딩 생성 | **DB Webhook → Edge Function `embed`** (비동기) | 저장 시 유저 대기 0 |
| 채팅 모델 | **OpenAI (Chat Completions, `stream: true`)** — 모델 ID는 env `OPENAI_CHAT_MODEL`로 뺀다 | 임베딩·채팅 한 공급자로 통일(유저 지시). 모델 세부는 §C에서 |
| 키 관리 | `OPENAI_API_KEY` = Edge Function 시크릿, **이미 env에 저장됨** | 앱에 키 절대 내장 금지 |

---

## Phase 0 — 토대 (임베딩 파이프라인)

### 0-1. 스키마 (Supabase SQL Editor에 붙여넣기)

```sql
create schema if not exists rudy;
create extension if not exists vector;      -- pgvector

-- 파편 임베딩. fragment와 1:1. 파편 삭제 시 cascade.
create table rudy.fragment_embeddings (
  fragment_id  uuid primary key
               references public.fragments(id) on delete cascade,
  embedding    vector(3072) not null,
  -- 임베딩의 원천 텍스트 해시. 내용이 안 바뀌었으면 재임베딩 스킵.
  source_hash  text not null,
  embedded_at  timestamptz not null default now()
);

-- RLS: 로그인 사용자 전체 허용 (Mind와 동일 정책)
alter table rudy.fragment_embeddings enable row level security;
create policy "authenticated full access" on rudy.fragment_embeddings
  for all to authenticated using (true) with check (true);

-- Edge Function(service role)이 rudy 스키마에 접근할 수 있게
grant usage on schema rudy to service_role, authenticated;
grant all on all tables in schema rudy to service_role, authenticated;
```

> ⚠️ Supabase Dashboard → Settings → API → "Exposed schemas"에 `rudy` 추가해야 PostgREST/RPC로 접근된다.

### 0-2. 임베딩 텍스트 규칙 (Edge Function·백필 공용)

```ts
// 링크 파편의 content는 URL이라 임베딩하면 무의미 → 제목+설명글·노트를 쓴다
// (2026-07-19 구현 시 og:description도 추가 — 제목만으론 여전히 얕은 신호였다).
// merged_from 조각의 content도 합쳐 신호를 살린다.
function embedText(f: FragmentRow): string {
  const merged = (f.merged_from ?? []).map((p: any) => p.content).filter(Boolean).join('\n');
  const head = f.type === 'link' ? [f.link_title ?? f.content, f.link_description] : [f.content];
  return [...head, f.note, merged].filter(Boolean).join('\n').trim();
}
// source_hash = sha256(embedText). 값이 같으면 재임베딩 안 함.
// 실제 구현: supabase/functions/embed/index.ts, scripts/backfill-embeddings.mjs (양쪽 동일해야 함)
```

### 0-3. Edge Function `embed` (저장 시 자동 호출)

`supabase/functions/embed/index.ts` — Deno.

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  // Database Webhook payload: { type, record, old_record, ... }
  const { record: f } = await req.json();
  if (!f?.id) return new Response('no record', { status: 400 });

  const text = embedText(f);
  if (!text) return new Response('empty', { status: 200 }); // 이미지-only 등

  const hash = await sha256(text);
  // 내용 안 바뀌었으면 스킵 (update 웹훅 대량 방지)
  const { data: existing } = await supabase
    .schema('rudy').from('fragment_embeddings')
    .select('source_hash').eq('fragment_id', f.id).maybeSingle();
  if (existing?.source_hash === hash) return new Response('unchanged', { status: 200 });

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-large', input: text }),
  });
  const { data } = await res.json();
  const embedding = data[0].embedding; // number[3072]

  await supabase.schema('rudy').from('fragment_embeddings').upsert({
    fragment_id: f.id, embedding, source_hash: hash, embedded_at: new Date().toISOString(),
  });
  return new Response('ok', { status: 200 });
});
```
(`embedText`, `sha256` 헬퍼는 같은 파일에. 시크릿: `supabase secrets set OPENAI_API_KEY=...`)

### 0-4. 자동 트리거 (Database Webhook)

Supabase Dashboard → Database → Webhooks → Create:
- Table: `public.fragments`
- Events: **Insert, Update**
- Type: Supabase Edge Function → `embed`

→ 파편을 던지면 몇 초 뒤 임베딩이 생긴다. 유저는 아무것도 기다리지 않는다.

### 0-5. 전체 백필 (기존 파편 1회)

`scripts/backfill-embeddings.ts` (로컬 Node 실행, service role 키 사용):

```
1. select id, type, content, link_title, link_description, note, merged_from
   from fragments where id not in (select fragment_id from rudy.fragment_embeddings)
2. 50개씩 배치 → OpenAI /embeddings (input: string[] 배치 지원)
3. rudy.fragment_embeddings upsert
4. rate limit: 배치 간 200ms sleep
```
→ 검증: `select count(*) from fragments` = `select count(*) from rudy.fragment_embeddings` (이미지-only 제외).

### ✅ Phase 0 완료 기준
- 새 파편 저장 → 5초 내 `rudy.fragment_embeddings`에 행 생김
- 백필 후 개수 일치
- **임베딩 모델 실측:** 파편 20개로 "음악"↔"피아노" 류 유사도가 상식과 맞는지 눈으로 확인 (한국어 품질이 위 단계 전부의 바닥)

---

## Phase A — 의미 검색 (C2)

### A-1. 하이브리드 검색 RPC

```sql
-- 질문 임베딩을 받아 키워드(부분일치) + 벡터 유사도 병합.
-- 검색은 "찾으러 온 행위" → 무덤 포함 전부 뒤진다(Mind 기존 규칙 유지).
create or replace function rudy.search_fragments(
  q_text   text,
  q_embed  vector(3072),
  match_count int default 30
)
returns table (id uuid, score real, matched_by text)
language sql stable as $$
  with kw as (       -- 기존 키워드 검색 (정확 일치 우대)
    select f.id, 1.0::real as score, 'keyword' as matched_by
    from public.fragments f
    where f.content ilike '%'||q_text||'%' or f.link_title ilike '%'||q_text||'%'
  ),
  vec as (           -- 벡터 유사도 (코사인)
    select e.fragment_id as id,
           (1 - (e.embedding <=> q_embed))::real as score,
           'vector' as matched_by
    from rudy.fragment_embeddings e
    order by e.embedding <=> q_embed
    limit match_count
  )
  select id, max(score) as score,
         string_agg(distinct matched_by, '+') as matched_by
  from (select * from kw union all select * from vec) u
  group by id
  order by score desc
  limit match_count;
$$;
```

### A-2. 클라이언트 연동 (기존 검색창 그대로)

[src/lib/supabase.ts](src/lib/supabase.ts)의 `searchFragments`를 교체:

```ts
export async function searchFragments(query: string): Promise<Fragment[]> {
  const q = query.trim();
  if (!q) return [];
  if (!isConfigured) { /* 기존 픽스처 경로 유지 */ }

  // 1) 질문 임베딩 (Edge Function 경유 — 앱에 OpenAI 키 없음)
  const { data: emb } = await supabase().functions.invoke('embed-query', { body: { text: q } });
  // 2) 하이브리드 RPC
  const { data: hits, error } = await supabase().schema('rudy')
    .rpc('search_fragments', { q_text: q, q_embed: emb.embedding, match_count: 30 });
  if (error) throw error;
  // 3) id → 파편 로드 (기존 fetchFragmentsByIds, 순서 보존)
  const frs = await fetchFragmentsByIds(hits.map((h: any) => h.id));
  const order = new Map(hits.map((h: any, i: number) => [h.id, i]));
  return frs.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
}
```

새 Edge Function `embed-query` = `embed`에서 OpenAI 호출부만 떼어 `{embedding}` 반환.
[SearchOverlay.tsx](src/components/SearchOverlay.tsx)는 **수정 없음** — 함수 시그니처 동일.

### ✅ Phase A 완료 기준
- "음악" 검색 시 "피아노 배우기" 파편이 결과에 뜬다 (키워드론 안 잡히던 것)
- 기존 정확 일치 결과는 여전히 상단
- 새 화면 0개

---

## Phase B — 충돌 회상 (A1) · "떠오름" 개선

> 현재 [recall.ts](src/lib/recall.ts)는 **가중 랜덤 제비뽑기**다. 오늘 뭘 던졌는지와 무관 → 이유가 없어 무시당함.
> 개선: 하루 2개 중 **1개를 충돌**로. "오늘 던진 것과 의미가 부딪히는, 잊혀가던 파편"을 올린다. 1개는 순수 랜덤 유지(에코챔버 방지).

### B-1. 충돌 RPC

```sql
-- seed = 오늘/최근 던진 파편들의 평균 임베딩. 그와 가까우면서 흐려진 후보를 점수화.
-- 선명도(흐려진 정도)는 앱에서 계산하므로, 여기선 후보 + 유사도만 반환하고
-- 최종 점수 = 유사도 × 흐려짐 × 가중치는 recall.ts에서 (데이터는 사실만, 해석은 화면에서).
create or replace function rudy.collision_candidates(
  seed_embed vector(3072),
  exclude_ids uuid[],           -- 오늘 던진 것들(자기 자신 제외)
  match_count int default 20
)
returns table (id uuid, similarity real)
language sql stable as $$
  select e.fragment_id, (1 - (e.embedding <=> seed_embed))::real
  from rudy.fragment_embeddings e
  join public.fragments f on f.id = e.fragment_id
  where f.archived = false
    and not (e.fragment_id = any(exclude_ids))
  order by e.embedding <=> seed_embed
  limit match_count;
$$;
```

### B-2. recall.ts 통합 (억지 충돌 금지 = 임계 게이트)

```ts
const COLLISION_THRESHOLD = 0.35;  // 초기값. 실사용 튜닝. 못 넘으면 랜덤 2개.

async function collisionPick(now: Date): Promise<Fragment | null> {
  const seedIds = await recentThrownIds(3);          // 최근 3일 던진 파편
  if (seedIds.length === 0) return null;
  const seed = await avgEmbedding(seedIds);          // rudy RPC or 평균 계산
  const { data } = await supabase().schema('rudy')
    .rpc('collision_candidates', { seed_embed: seed, exclude_ids: seedIds, match_count: 20 });

  const pool = await fetchFragmentsByIds(data.map((d:any)=>d.id));
  const scored = pool
    .filter(fr => stillFading(fr, now))              // 흐려진 것만 (기존 로직 재사용)
    .map(fr => {
      const sim = data.find((d:any)=>d.id===fr.id).similarity;
      const faded = 1 - vividness(fr, now);          // 흐릴수록 큼
      return { fr, score: sim * faded * weight(fr) };
    })
    .sort((a,b) => b.score - a.score);

  const top = scored[0];
  return top && top.score >= COLLISION_THRESHOLD ? top.fr : null;  // 임계 미달이면 침묵
}

// todayRecall(): 충돌 1개(있으면) + 랜덤 1개, 없으면 랜덤 2개
```

### B-3. 요청 시 가시성 ("왜 지금")
떠오른 파편 롱프레스 → "오늘 던진 『○○』와 닿아 있어" 한 줄. 렌더 시점 계산, **무저장**(Mind §7 연결 저장 금지 정합). seed 중 유사도 최상위 파편의 content 일부를 보여줌.

### ✅ Phase B 완료 기준
- 재즈 파편 던진 날, 3주 전 "피아노 코드"가 떠오른 것에 뜬다
- 롱프레스하면 이유가 읽힌다
- 씨앗 없거나 임계 미달인 날은 그냥 랜덤 2개 (억지 충돌 없음)

---

## Phase C — 채팅 (C1) · RAG

### C-1. Edge Function `chat` (스트리밍 RAG, OpenAI)

`supabase/functions/chat/index.ts`:

```ts
// 1. 질문 임베딩 (OpenAI, 이미 embed-query와 동일 로직 재사용)
// 2. rudy.search_fragments로 근거 파편 top-K(8) 검색 → 본문 로드
// 3. OpenAI Chat Completions 스트리밍 호출, 근거를 컨텍스트로. 인용 없는 단정 금지.
const OPENAI_CHAT_MODEL = Deno.env.get('OPENAI_CHAT_MODEL') ?? 'gpt-4o'; // env로 뺌, 나중에 바꿀 수 있게

const system = `너는 Rudy다. 유저의 파편(기억) 위에서 대화한다.
- 아래 <근거> 파편만 사실로 인용한다. 근거에 없으면 "저장된 것 중엔 없다"고 말한다. 인용 없는 단정 금지.
- 모르거나 불확실하면 되묻는다.
- 규정 금지: "너는 ~한 사람" 금지. 항상 시간 한정("요즘 ~가 보여").
- 짧게. 아첨 없음.`;

// OpenAI Chat Completions API, stream: true
const resp = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')!}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: OPENAI_CHAT_MODEL,
    stream: true,
    messages: [
      { role: 'system', content: system },
      ...history,                                   // 이전 대화 ({role, content}[])
      { role: 'user', content: `<근거>\n${citedFragments}\n</근거>\n\n${question}` },
    ],
  }),
});
// resp.body는 OpenAI SSE (data: {...} 줄 단위, [DONE]으로 종료).
// 클라이언트가 바로 파싱하기 쉽게 delta.content만 뽑아 재포맷해서 흘려보낸다.
```

> **모델 선택은 열어둠.** `gpt-4o`는 안전한 기본값이지 확정이 아니다 — 실제 지연·품질 보고 나서
> `OPENAI_CHAT_MODEL` 값만 바꾸면 된다(코드 수정 불필요). reasoning 계열(o-시리즈)로 갈 경우
> 스트리밍·시스템 프롬프트 처리 방식이 달라지니 그때 이 섹션 재검토.

> ⚠️ 채팅은 touch가 아니다(RUDY.md §2-3). 근거로 읽은 파편의 `last_touched_at`을 **절대 갱신하지 않는다.**

### C-2. 자발적 연결 (킬러 무브, C1)
유저 메시지도 임베딩 → `collision_candidates`로 코퍼스 충돌 검사 → 임계 넘으면 답변에 "그거 3주 전 『○○』랑 이어지는데?" 한 줄. 미달이면 침묵. (Phase B 엔진 재사용.)

### C-3. 채팅 표면 (새 탭)
- `src/app/(drawer)/chat.tsx` 신설 — 드로어에 "Rudy" 탭 추가.
- 메시지 리스트 + 입력창 + 스트리밍 렌더. 기존 다크 테마([theme.ts](src/lib/theme.ts)) 재사용.
- `conversations`/`messages` 테이블(rudy 스키마)에 이력 저장 → 다음 대화 맥락.
- **원탭 진입:** [fragment/[id].tsx](src/app/fragment/[id].tsx) 상세에 칩("이거 관련 뭐 있었지") → chat 탭으로 질문 프리필.

```sql
create table rudy.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), title text
);
create table rudy.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references rudy.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role in ('user','assistant')),
  content text not null,
  cited_ids uuid[] default '{}'    -- 인용한 파편 (원장의 씨앗)
);
```

### ✅ Phase C 완료 기준
- "내가 홈레코딩 관련 뭐 저장했었지?" → 근거 파편 인용해서 답한다
- 답이 스트리밍으로 바로바로 나온다
- 근거 없는 질문엔 "저장된 것 중엔 없다"고 한다 (환각 안 함)
- 대화해도 파편 선명도 안 변한다 (touch 불변 검증)

---

## 착수 순서 요약

```
0. 스키마 + embed Edge Function + Webhook + 백필 + 모델 실측   ← 지금 여기부터
0.5 embed-query Edge Function
A. search_fragments RPC + searchFragments 교체                ← 첫 체감
C. chat Edge Function + 채팅 탭 + RAG                          ← GPT가 못 하던 그것
B. collision RPC + recall.ts 개선 (병행 가능)                 ← 떠오름 고치기
```

각 Phase는 독립적으로 배포·검증 가능한 조각이다.

---

## 열린 것 (구현 중 결정)
- 채팅 모델 = OpenAI로 확정(2026-07-19). 구체 모델 ID(`gpt-4o` vs 다른 것)는 `OPENAI_CHAT_MODEL`
  env 값만 바꾸면 되므로 실제 지연·품질 보고 나서 택 — 코드 변경 불필요
- 코퍼스가 수만 개 넘으면: 차원 축소(`dimensions: 1536`) + HNSW 인덱스 도입
- `conversations` RLS 정책 (Mind와 동일 authenticated full access로 시작)
- **링크 임베딩 품질 개선 (2026-07-19, Phase 0 안에서 처리).** 제목만으론 유령 파편이 심해
  `fragments.link_description`(og:description) 컬럼을 추가해 임베딩에 포함시켰다(PLAN.md §3.6).
  화면 표시는 상세에 작게만 — 주 목적은 임베딩 신호, 요약/의도 해석(다이제스트 B3)이 아니다.
  다이제스트(LLM 요약·의도 추정)는 여전히 미룬다 — 소비 표면(채팅, Phase C)이 생긴 뒤 lazy 계산.
  일회성 백필: `scripts/backfill-link-desc.mjs`(기존 링크) → `scripts/check-embeddings.mjs`(실측,
  `--links` 플래그로 링크만 랭킹 확인).
