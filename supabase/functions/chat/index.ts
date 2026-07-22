// Rudy 채팅 — RAG + 자발적 연결 + 스트리밍 (RUDY.md §4-C1 · §10-5, RUDY-BUILD.md C-1·C-2).
//
// ⚠️ 채팅은 touch가 아니다 (§2-3). 이 함수는 public.fragments를 select만 한다 —
//    근거로 읽었다는 이유로 파편이 선명해지면 "그냥 봤다고 선명해지면 안 된다"가 뒷문으로 깨진다.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  CHAT_MODEL,
  chatStream,
  complete,
  embedMany,
  FAST_MODEL,
  type ChatMessage,
  type UsageSink,
} from '../_shared/openai.ts';
import { costTracker } from '../_shared/usage.ts';
import { systemPrompt } from './prompt.ts';
import { axesBlock, findAxes, MIN_SIM as CLUSTER_MIN_SIM, type Axis } from './clusters.ts';
import { captureAnswer, logQuestion, pickQuestion, questionSubject, type Target } from './intent.ts';
import { kstDate, kstRange, kstToday, PERIOD_LABEL, type Period } from '../_shared/time.ts';
import { exaSearch } from '../discovery/search.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CITE_COUNT = 10; // 근거로 넘길 파편 수
// ⚠️ 점수 바닥 컷은 두지 않는다. 실측(2026-07-19, check-search.mjs): 질문 문장 임베딩은
// 관련 파편도 0.28~0.43에 깔려서, 어떤 바닥이든 신호를 자른다(충돌 튜닝 때 본 이방성과 동일).
// 관련성 판정은 근거를 직접 보는 모델이 한다 — 숫자 하나로 미리 자르는 게 더 나쁘다.

// 자발적 연결 임계. 회상의 0.42를 그대로 안 쓴다 — 질문↔파편은 파편↔파편과 유사도 분포가
// 다르다(위 실측과 같은 이유). 잠정값이고, 판정마다 gate_log에 실측을 남긴다(§6-4).
const LINK_THRESHOLD = 0.34;
const LINK_COOLDOWN_DAYS = 30; // 되살리기와 같은 쿨다운 (§4-C1 표면 간 중복 방지)
const HISTORY_LIMIT = 20; // 맥락으로 넘길 이전 메시지 수
const PERIOD_LIMIT = 40; // 기간 조회 상한 (하루에 40개 넘게 던지면 최신순으로 자른다)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Frag = {
  id: string;
  created_at: string;
  type: string;
  content: string;
  link_title: string | null;
  link_description: string | null;
  note: string | null;
};

const FRAG_COLS = 'id, created_at, type, content, link_title, link_description, note';

// 근거 한 조각. 모델이 [『제목』](mind://fragment/id)로 인용할 수 있게 id를 넣고,
// 프로젝트 소속과 원본 URL도 준다 — "링크 달라", "프로젝트로 가자"에 답할 재료.
function fragBlock(f: Frag, projects: { id: string; name: string }[]): string {
  const date = kstDate(f.created_at); // UTC로 찍으면 새벽 저장분이 하루 전으로 보인다
  const title = f.type === 'link' ? (f.link_title ?? f.content) : f.content;
  const lines = [
    `- id: ${f.id}`,
    `  날짜: ${date}`,
    `  내용: ${title.replace(/\n/g, ' ')}`,
  ];
  if (f.type === 'link') {
    lines.push(`  URL: ${f.content}`);
    if (f.link_description) lines.push(`  설명: ${f.link_description.replace(/\n/g, ' ')}`);
  }
  if (f.note) lines.push(`  덧: ${f.note.replace(/\n/g, ' ')}`);
  if (projects.length) {
    lines.push(`  프로젝트: ${projects.map((p) => `${p.name} (id: ${p.id})`).join(', ')}`);
  }
  return lines.join('\n');
}

// 질문 문장을 그대로 임베딩하면 검색이 망가진다 (2026-07-19 실측).
// "내가 홈레코딩 관련 저장한 거 있어? 링크도 줘"를 통째로 임베딩하면 "저장/링크" 같은
// 메타 표현이 벡터를 지배해서, 홈레코딩이 아니라 **앱의 링크·저장 기능에 대한 파편**이
// 상위에 온다(실측 1위 0.535 "링크 던지면 요약해서…"). 유저가 검색창에 "홈레코딩"만
// 치면 잘 나오던 이유가 이것이다 — 그래서 검색어를 질문에서 뽑아낸 뒤 검색한다.
// 아래 문구는 실측으로 조인 것이다 (2026-07-19). 동작어("정리","저장한 자료")가 주제어로
// 새어나오면 그 단어의 키워드 매치가 1.0점으로 상위를 먹어 검색이 다시 망가진다.
const EXTRACT_SYS = `사용자의 질문을 개인 메모 저장소 검색용으로 분해한다.
<최근대화>가 주어지면 그걸 맥락으로 읽는다.

topics — 검색할 주제어:
- 구체적인 소재·분야·고유명사만. 예: "홈레코딩", "기타", "카페 창업"
- ⚠️ **"그거/이거/저거/방금 그거/그 링크" 같은 지시어는 <최근대화>에서 실제 소재로 풀어서 넣어라.**
  예: 루디가 "케이스랩 메모"를 말한 뒤 "그거 찾아봐" → topics=["케이스랩"]. 지시어를 그대로 두지 마라.
- 다음은 절대 주제어가 아니다 — 버린다: 저장/기록/메모/정리/요약/링크/자료/목록,
  알려줘/보여줘/찾아줘, 최근/요즘/관심사/경향 같은 메타 표현
- 질문에 구체적 소재가 없으면(예: "요즘 뭐에 꽂혔어?") 빈 배열
- 1~3개, 짧은 명사구

type — 특정 종류만 찾는 질문이면 그 종류, 아니면 null:
- "링크/URL/사이트/영상 뭐 있지" → "link"
- "사진/이미지/캡쳐" → "image"
- "인용구/문장" → "quote"
- 종류를 안 가리면 null

period — **특정 기간에 저장한 것**을 묻는 질문이면 그 기간, 아니면 null:
- "오늘 뭐 저장했지", "오늘은 무슨 생각 했지" → "today"
- "어제 던진 거" → "yesterday"
- "이번 주", "지난주", "요 며칠" → "week"
- "이번 달", "최근 한 달" → "month"
- 기간을 안 가리키면 null. "요즘 뭐에 꽂혔어?"는 기간이 아니라 경향 질문이다 → null

intent — 이 메시지가 무엇인지:
- "trend": 최근 경향·관심사를 묻는 질문. "요즘 뭐에 꽂혔어?", "내 관심사가 뭐야"
- "other": 그 외 전부. 구체적인 검색, 세상 지식 질문, 그리고 **질문이 아닌 것**
  (진술·감상·인사·잡담). 묻지 않았으면 trend가 아니다.

outward — 바깥(웹)에서 찾는 것과의 관계. **단, 이 사람의 세계(파편·프로젝트·관심)와 연결될 때만이다.**
루디는 만능 검색기가 아니다 — 날씨·환율·일반 사실 조회는 바깥이 아니다("no").
- "go": **명시적으로 바깥을 요청**했고 이 사람 맥락과 연결됨. "이런 거 찾아봐", "비슷한 프로덕트 찾아줘",
  "~ 사례 검색해줘", "그거 관련해서 바깥에 뭐 있나 찾아줘". 요청이 분명하면 바로 간다.
- "ask": 바깥이 **도움될 순 있지만 명시적으로 요청 안 함** (애매). "케이스랩 어때?", "이거 괜찮나?".
  → 마음대로 뒤지지 말고 물어본다.
- "no": 바깥 불필요. 저장소 질문, 순수 지식/개념, 잡담, 그리고 **이 사람 세계와 무관한 사실 조회
  (날씨·시세 등)**. 애매하면 no.

JSON만 출력: {"topics":["..."],"type":null,"period":null,"intent":"other","outward":"no"}`;

type OutwardMode = 'no' | 'ask' | 'go';
type Extracted = {
  topics: string[];
  type: string | null;
  period: Period | null;
  intent: string;
  outward: OutwardMode;
};
const OUTWARD: OutwardMode[] = ['no', 'ask', 'go'];
const TYPES = ['text', 'link', 'image', 'quote'];
const PERIODS = ['today', 'yesterday', 'week', 'month'];

// recent = 최근 대화 몇 줄. "그거/이거" 같은 지시어를 여기서 실제 소재로 풀어야 검색이 조준된다.
// 이게 없어서 "오늘 뭐 남겼지 → 그거 찾아봐"의 '그거'가 헛돌았다 (2026-07-21 유저 지적).
async function searchQueries(question: string, recent: string, onUsage?: UsageSink): Promise<Extracted> {
  const user = recent ? `<최근대화>\n${recent}\n</최근대화>\n\n질문: ${question}` : question;
  const raw = await complete(
    [
      { role: 'system', content: EXTRACT_SYS },
      { role: 'user', content: user },
    ],
    FAST_MODEL,
    onUsage,
  );
  const p = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
  return {
    topics: Array.isArray(p?.topics)
      ? p.topics.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 3)
      : [],
    type: TYPES.includes(p?.type) ? p.type : null,
    period: PERIODS.includes(p?.period) ? (p.period as Period) : null,
    intent: p?.intent === 'trend' ? 'trend' : 'other',
    outward: OUTWARD.includes(p?.outward) ? (p.outward as OutwardMode) : 'no',
  };
}

// 바깥(웹) 검색 결과를 모델에 넘길 블록. 채팅이 저장소를 넘어 바깥까지 뻗는 자리(§4-E 정신).
// 저장소 근거(<근거>)와 섞이지 않게 별도 블록으로 준다 — 출처 URL로 인용하게.
async function outwardBlock(queries: string[]): Promise<string> {
  const q = queries.join(' ').trim();
  if (!q) return '';
  const results = await exaSearch(q, 6);
  if (!results.length) return '';
  return results
    .map((r) => {
      const date = r.publishedDate?.slice(0, 10) ?? '';
      const hl = r.highlights.join(' … ').slice(0, 500);
      return `- ${r.title ?? '(제목없음)'}${date ? ` (${date})` : ''}\n  ${r.url}\n  ${hl}`;
    })
    .join('\n');
}

// 게이트 판정은 사유와 함께 남긴다 (§6-4). 실패해도 삼킨다 — 로그 때문에 채팅이 죽으면 본말전도.
// 기다리지도 않는다(fire-and-forget) — 로그가 첫 토큰을 늦출 이유가 없다.
function logGate(
  gate: string,
  passed: boolean,
  reason: string,
  detail: unknown,
  kind = 'resurface',
) {
  supabase
    .schema('rudy')
    .from('gate_log')
    .insert({ surface: 'chat', kind, gate, passed, reason, detail })
    .then(undefined, (e) => console.warn('[gate_log]', e));
}

// 자발적 연결 (§4-C1 킬러 무브) — 묻지도 않았는데 잊고 있던 과거가 대화에 걸어 들어온다.
// 임계 미달이면 null. 억지로 이으면 유저는 무시를 학습하고 마법이 통째로 죽는다(§2-8).
async function findLink(qEmbed: number[], excludeIds: string[]): Promise<Frag | null> {
  // 쿨다운 — 되살리기와 원장을 공유하므로 떠오른 것에서 이미 본 파편은 여기서 안 나온다.
  const since = new Date(Date.now() - LINK_COOLDOWN_DAYS * 86_400_000).toISOString();
  const { data: recent } = await supabase
    .schema('rudy')
    .from('utterances')
    .select('item_ids')
    .eq('kind', 'resurface')
    .gte('created_at', since);
  const cooled = new Set((recent ?? []).flatMap((r) => (r.item_ids ?? []) as string[]));

  const { data: hits, error } = await supabase
    .schema('rudy')
    .rpc('collision_by_embedding', { q_embed: qEmbed, exclude_ids: excludeIds });
  if (error) throw error;

  const fresh = ((hits ?? []) as { id: string; similarity: number }[]).filter(
    (h) => !cooled.has(h.id),
  );
  const top = fresh[0];
  const passed = !!top && top.similarity >= LINK_THRESHOLD;
  logGate(
    'similarity',
    passed,
    passed ? '자발적 연결 성립' : '임계 미달 — 억지로 잇지 않고 침묵',
    { best: top?.similarity ?? null, threshold: LINK_THRESHOLD, pool: fresh.length },
  );
  if (!passed) return null;

  const { data } = await supabase.from('fragments').select(FRAG_COLS).eq('id', top.id).single();
  return (data as Frag) ?? null;
}

// 클라이언트로는 NDJSON 한 줄씩 흘린다 — 청크 경계가 어디서 잘리든 줄 단위로 다시 맞춰진다.
const line = (o: unknown) => new TextEncoder().encode(`${JSON.stringify(o)}\n`);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { conversationId, question } = await req.json();
  if (!conversationId || !question?.trim()) {
    return new Response(JSON.stringify({ error: 'conversationId·question 필요' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // 비용 추적 (2026-07-22) — 이 턴에서 도는 모든 gpt 호출(재작성·캡처판정·축라벨·본답변)을
  // 하나의 request_id로 묶는다. "각 응답마다 얼마" 표시의 원천.
  const cost = costTracker(supabase, { requestId: crypto.randomUUID(), conversationId });

  // 이력은 질문과 무관하게 읽을 수 있다 — 임베딩·검색과 병렬로 (첫 토큰까지의 시간이 체감이다)
  const historyPromise = supabase
    .schema('rudy')
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  // 직전에 루디가 뭘 물었다면, 이 메시지가 그 답일 수 있다 (§4-F1).
  // 대기 중인 질문이 없으면 조회 한 번으로 끝나므로 매 턴 돌려도 싸다.
  // 검색과 병렬 — 캡처가 늦어져도 답변이 기다릴 이유가 없다.
  const capturePromise = captureAnswer(
    supabase,
    question,
    (g, p, r, d) => logGate(g, p, r, d, 'question'),
    cost.track('chat.question_judge', FAST_MODEL),
  ).catch((e) => {
    console.warn('[chat] 자기 진술 캡처 실패', e);
    return null;
  });

  // 이력을 먼저 읽는다 — 검색어 추출이 "그거/이거"를 최근 대화에서 풀 수 있게(§유저 지적).
  // 답변에도 쓰이므로 여기서 한 번 await하고 재사용한다.
  const { data: history } = await historyPromise;
  const recent = ((history ?? []) as ChatMessage[])
    .slice(0, 4)
    .reverse()
    .map((m) => `${m.role === 'user' ? '나' : '루디'}: ${(m.content ?? '').replace(/\n/g, ' ').slice(0, 200)}`)
    .join('\n');

  // 검색어를 뽑는다. 실패하면 질문 그대로 — 재작성이 죽어도 채팅은 살아야 한다.
  const { topics, type, period, intent, outward } = await searchQueries(
    question,
    recent,
    cost.track('chat.rewrite', FAST_MODEL),
  ).catch((e) => {
    console.warn('[chat] 질의 재작성 실패 → 질문 원문으로 검색', e);
    return { topics: [] as string[], type: null, period: null, intent: 'other', outward: 'no' as OutwardMode };
  });

  // 바깥 검색은 **명시적 요청(go)일 때만** 뻗는다 (§2-8 침묵 기본값 + 유저 통제). RAG와 병렬로.
  // 'ask'면 안 뒤지고 프롬프트가 "바깥에서 찾아볼까?"를 물어보게 한다. 실패해도 채팅은 산다.
  const outwardPromise: Promise<string> = outward === 'go'
    ? outwardBlock(topics.length ? topics : [question]).catch((e) => {
        console.warn('[chat] 바깥 검색 실패 → 없이 진행', e);
        return '';
      })
    : Promise.resolve('');
  // 캡처를 먼저 끝낸다 — 방금 받아낸 자기 진술이 아래 축 계산에 반영되게.
  // 대기 중인 질문이 없으면 즉시 끝나므로 사실상 공짜다.
  const answered = await capturePromise;

  // ── 축 경로 (§10-6). 예전엔 여기서 질문 원문으로 검색했는데 그게 위에 적어둔 오염된
  // 경로라 아무거나 물어왔다. 이제 그 자리를 클러스터가 답한다.
  //
  // ⚠️ 조건이 `topics.length === 0`뿐이었는데 **그건 너무 넓었다** (2026-07-20 실사용).
  // 주제어가 안 나오는 건 메타 질문만이 아니다 — 진술·인사·잡담이 전부 빈 배열이다.
  // 늦은 의도 질문에 "그냥 재밌어보여서, 나 음악 했었어"라고 답한 걸 질문으로 착각해
  // **축 보고서를 또 냈다**(앞 턴과 거의 같은 답 = §2-2 위반).
  // → intent를 따로 뽑아 **셋 다 만족할 때만** 축으로 간다. 프록시 신호를 질문 판정에 쓰지 않는다.
  let axes: Axis[] = [];
  if (intent === 'trend' && !topics.length && !answered && !period) {
    try {
      axes = await findAxes(supabase, new Date(), cost.track('chat.axis_label', FAST_MODEL));
    } catch (e) {
      console.warn('[chat] 클러스터 실패 → 검색으로 폴백', e);
    }
    // 판정을 남긴다 (§6-4). 임계 0.42는 5일치 코퍼스로 정한 잠정값이라 며칠 뒤 이 로그로
    // 재조정한다 — 충돌 임계를 감으로 정했다가 뒤집은 것과 달리 이번엔 처음부터 근거가 쌓인다.
    logGate(
      'cluster',
      axes.length > 0,
      axes.length ? '축 성립' : '묶이는 축 없음 — 검색으로 폴백',
      {
        threshold: CLUSTER_MIN_SIM,
        axes: axes.map((a) => ({
          label: a.label,
          size: a.items.length,
          kind: a.kind,
          spanDays: Math.round(a.spanDays),
          activeDays: a.activeDays,
          quietDays: Math.round(a.quietDays),
        })),
      },
      'cluster',
    );
  }
  const useAxes = axes.length > 0;

  // 주제어가 나오면 **그것만** 쓴다. 원문을 섞으면 메타 표현이 다시 검색을 오염시킨다
  // (실측: 원문을 섞으면 "링크 던지면 요약…"이 0.535로 1위, 빼면 "음성으로 녹음" 0.511이 1위).
  // 축이 안 서는 질문만 원문으로 검색해 폴백한다 — 채팅에서 침묵은 답이 아니다.
  const queries = topics.length ? topics : [question];

  let citedIds: string[] = [];
  let evidence = '';
  let link: Frag | null = null;
  let periodNote = '';

  if (period) {
    // ⚠️ 시간 질의는 **검색으로 답할 수 없다.** "오늘 뭐 저장했지"를 임베딩 유사도로
    // 처리하면 오늘 저장한 게 6개 있어도 질문 문장과 의미가 안 닿으면 안 나오고,
    // 모델은 태연히 "오늘 남긴 게 없네"라고 답한다 (2026-07-20 실사용에서 터짐).
    // 기간이 잡히면 유사도를 아예 안 쓰고 **그 기간에 저장된 것을 날짜로 전부 가져온다.**
    // 경계는 KST 자정 (_shared/time.ts) — UTC로 자르면 새벽에 하루가 밀린다.
    const { since, until } = kstRange(period);
    const { data: rows } = await supabase
      .from('fragments')
      .select(FRAG_COLS)
      .eq('archived', false)
      .gte('created_at', since)
      .lt('created_at', until)
      .order('created_at', { ascending: false })
      .limit(PERIOD_LIMIT);
    const inPeriod = (rows ?? []) as Frag[];
    citedIds = inPeriod.map((f) => f.id);
    evidence = inPeriod.map((f) => fragBlock(f, [])).join('\n');
    periodNote = `${PERIOD_LABEL[period]}(${since.slice(0, 10)} 이후) 저장한 파편 ${inPeriod.length}개 — 검색 결과가 아니라 전부다`;
  } else if (useAxes) {
    // 축 자체가 근거다. 검색도, 자발적 연결도 안 돈다 — 이 답변은 이미 통째로
    // "묻지 않은 것을 꺼내는" 일이라, 거기 또 연결을 얹으면 같은 동작의 반복이다.
    citedIds = axes.flatMap((a) => a.items.map((f) => f.id));
    evidence = axesBlock(axes);
  } else {
    // 자발적 연결은 질문 원문 기준이라 원문 임베딩도 필요하다 — 한 번에 받는다
    const embeds = await embedMany([...queries, question]);
    const qEmbed = embeds[embeds.length - 1];

    // 근거 검색 — 기존 하이브리드 RPC 그대로 쓴다 (검색과 채팅이 같은 랭킹을 봐야 말이 맞다).
    // 질의별로 돌리고 파편별 최고점으로 합친다.
    // type이 잡히면 그 종류만 (검색 UI의 타입 칩과 같은 동작).
    // "링크 뭐 있었지"에 링크 아닌 파편을 보여주면 답이 아니다.
    const runs = await Promise.all(
      queries.map((q, i) =>
        supabase.schema('rudy').rpc('search_fragments', {
          q_text: q,
          q_embed: embeds[i],
          match_count: CITE_COUNT,
          type_filter: type,
        }),
      ),
    );
    const failed = runs.find((r) => r.error);
    if (failed?.error) throw failed.error;

    const best = new Map<string, number>();
    for (const r of runs) {
      for (const h of (r.data ?? []) as { id: string; score: number }[]) {
        best.set(h.id, Math.max(best.get(h.id) ?? 0, h.score));
      }
    }
    citedIds = [...best.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CITE_COUNT)
      .map(([id]) => id);

    const { data: citedRows } = await supabase.from('fragments').select(FRAG_COLS).in('id', citedIds);
    // RPC의 점수 순서를 보존한다 — .in()은 순서를 보장하지 않는다
    const order = new Map(citedIds.map((id, i) => [id, i]));
    const cited = ((citedRows ?? []) as Frag[]).sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );

    // 근거 파편의 프로젝트 소속 — "프로젝트 상세로 가자"에 답할 재료
    const projByFrag = new Map<string, { id: string; name: string }[]>();
    if (citedIds.length) {
      const { data: maps } = await supabase
        .from('fragment_projects')
        .select('fragment_id, projects(id, name)')
        .in('fragment_id', citedIds);
      for (const m of (maps ?? []) as { fragment_id: string; projects: { id: string; name: string } }[]) {
        if (!m.projects) continue;
        const arr = projByFrag.get(m.fragment_id) ?? [];
        arr.push(m.projects);
        projByFrag.set(m.fragment_id, arr);
      }
    }
    evidence = cited.map((f) => fragBlock(f, projByFrag.get(f.id) ?? [])).join('\n');

    // 연결이 죽어도 대화는 살아야 한다 — 부가 기능이 본 기능을 인질로 잡지 않게.
    try {
      link = await findLink(qEmbed, citedIds);
    } catch (e) {
      console.warn('[chat] 자발적 연결 실패 → 연결 없이 진행', e);
    }
  }

  // 늦은 의도 (§4-F1). 축이 있으면 축에 묶인 파편을 우선한다 — 답 하나가 축 전체를
  // 추측에서 확인으로 올리기 때문. 예산·쿨다운은 pickQuestion 안에서 걸린다.
  let ask: Target | null = null;
  try {
    ask = await pickQuestion(
      supabase,
      new Set(axes.flatMap((a) => a.items.map((f) => f.id))),
      (g, p, r, d) => logGate(g, p, r, d, 'question'),
    );
  } catch (e) {
    console.warn('[chat] 늦은 의도 실패 → 안 묻고 진행', e);
  }

  const web = await outwardPromise; // 바깥 검색 결과 (없으면 빈 문자열). history는 위에서 이미 읽음.

  // ⚠️ UTC가 아니라 KST 기준 오늘. UTC로 넣으면 KST 새벽에 루디가 어제를 오늘로 안다.
  const today = kstToday();
  const context = [
    period
      ? `<기간>\n${periodNote}\n${evidence || '(이 기간에 저장한 것 없음)'}\n</기간>`
      : useAxes
        ? `<축>\n${evidence}\n</축>`
        : `<근거>\n${evidence || '(없음)'}\n</근거>`,
    web ? `<바깥>\n${web}\n</바깥>` : '',
    // 'ask' = 바깥이 도움될 수 있지만 안 뒤졌다. 억지 말고 도움되면 끝에 "바깥에서 찾아볼까?" 묻게.
    outward === 'ask' ? `<바깥가능>\n바깥에서 찾으면 도움될 수 있다. 억지로 말고, 정말 도움되겠으면 답 끝에 짧게 "바깥에서 찾아볼까?"라고만 물어라.\n</바깥가능>` : '',
    link ? `<연결>\n${fragBlock(link, [])}\n</연결>` : '',
    answered ? `<방금답함>\n${questionSubject(answered)}\n</방금답함>` : '',
    ask ? `<물어볼것>\n${questionSubject(ask)}\n</물어볼것>` : '',
    question,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(today) },
    ...((history ?? []).reverse() as ChatMessage[]), // 최신순으로 받아 시간순으로 되돌린다
    { role: 'user', content: context },
  ];

  // 원장은 자발적 연결만 적는다. 평범한 채팅 답변은 안 적는다 —
  // 원장은 §2-2 "먼저 거는 말"의 중복 방지 장치인데, 질문에 답한 걸 전부 넣으면
  // 반복 게이트가 오염된다(§6-4 ⑤도 채팅 응답은 무예산). 묻지 않고 나간 말만 기록 대상이다.
  let utteranceId: string | null = null;
  if (link) {
    const { data } = await supabase
      .schema('rudy')
      .from('utterances')
      .insert({ surface: 'chat', kind: 'resurface', item_ids: [link.id] })
      .select('id')
      .single();
    utteranceId = data?.id ?? null;
  }
  // 질문도 원장에 남긴다 — 같은 파편을 두 번 묻지 않기 위한 쿨다운이 이걸로 성립한다.
  if (ask) await logQuestion(supabase, ask);

  // 클라이언트가 중단(■)하면 cancel이 불린다 — 그만 만들고, 받은 데까지 저장한다.
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      // 클라이언트가 끊긴 뒤의 enqueue는 던진다 — 삼키고 저장 경로로 간다
      const push = (o: unknown) => {
        try {
          controller.enqueue(line(o));
        } catch {
          cancelled = true;
        }
      };

      let answer = '';
      try {
        // 근거를 먼저 흘린다 — 저장이 실패해도 앱이 근거 칩을 그릴 수 있어야 한다.
        // 모델이 링크를 안 걸어도 이 칩이 있으면 검색과 같은 수준으로 결과가 보인다.
        if (outward === 'go') push({ t: 'web' }); // 바깥을 뒤졌다 — 앱이 "바깥에서 찾아봤다"를 표시
        push({ t: 'cite', ids: citedIds });
        if (link && utteranceId) push({ t: 'link', fragmentId: link.id, utteranceId });
        for await (const delta of chatStream(messages, CHAT_MODEL, cost.track('chat.answer', CHAT_MODEL))) {
          if (cancelled) break; // 중단 — OpenAI 스트림도 여기서 놓는다
          answer += delta;
          push({ t: 'd', c: delta });
        }
      } catch (e) {
        console.error('[chat]', e);
        push({ t: 'error', message: String(e) });
      } finally {
        // 이력은 서버가 적는다 — 앱이 스트리밍 중에 죽거나 중단해도 받은 데까지 남는다.
        if (answer) {
          const { usd: costUsd } = cost.result(); // 이 턴에 쓴 gpt 호출 전부(재작성·판정·라벨·답변) 합계
          const { error } = await supabase
            .schema('rudy')
            .from('messages')
            .insert([
              // ⚠️ cited_ids를 명시해야 한다. PostgREST 다중 행 insert는 행마다 키가 다르면
              // 빠진 키를 default가 아니라 null로 채운다 — not null 제약에 걸려 저장 전체가
              // 죽었고, 그게 "다음 전송 잠김"의 뿌리였다 (2026-07-19 실측, 23502).
              { conversation_id: conversationId, role: 'user', content: question, cited_ids: [] },
              {
                conversation_id: conversationId,
                role: 'assistant',
                content: answer,
                cited_ids: citedIds,
                cost_usd: costUsd,
              },
            ]);
          if (error) console.warn('[chat] 이력 저장 실패', error);

          // 대화 이름은 첫 질문이다. 요약 모델을 부르지 않는다 — 목록에서 알아보는 게 목적이지
          // 잘 지은 제목이 목적이 아니다. 이미 이름이 있으면 건드리지 않는다.
          await supabase
            .schema('rudy')
            .from('conversations')
            .update({ title: question.slice(0, 60) })
            .eq('id', conversationId)
            .is('title', null)
            .then(undefined, (e) => console.warn('[chat] 제목 저장 실패', e));

          // ⚠️ 저장이 끝난 뒤에 보낸다. 앱은 이 신호를 보고서야 화면의 답을 지운다 —
          // 스트림이 닫혔다는 것만으로 지우면 아직 안 적힌 답을 못 찾고 증발시킨다.
          push({ t: 'done', saved: !error, costUsd });
        }
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 */
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: { ...cors, 'Content-Type': 'application/x-ndjson' },
  });
});
