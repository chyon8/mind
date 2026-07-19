// Rudy 채팅 — RAG + 자발적 연결 + 스트리밍 (RUDY.md §4-C1 · §10-5, RUDY-BUILD.md C-1·C-2).
//
// ⚠️ 채팅은 touch가 아니다 (§2-3). 이 함수는 public.fragments를 select만 한다 —
//    근거로 읽었다는 이유로 파편이 선명해지면 "그냥 봤다고 선명해지면 안 된다"가 뒷문으로 깨진다.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { chatStream, complete, embedMany, type ChatMessage } from '../_shared/openai.ts';
import { systemPrompt } from './prompt.ts';

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
  const date = f.created_at.slice(0, 10);
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

topics — 검색할 주제어:
- 구체적인 소재·분야·고유명사만. 예: "홈레코딩", "기타", "카페 창업"
- 다음은 절대 주제어가 아니다 — 버린다: 저장/기록/메모/정리/요약/링크/자료/목록,
  알려줘/보여줘/찾아줘, 최근/요즘/관심사/경향 같은 메타 표현
- 질문에 구체적 소재가 없으면(예: "요즘 뭐에 꽂혔어?") 빈 배열
- 1~3개, 짧은 명사구

type — 특정 종류만 찾는 질문이면 그 종류, 아니면 null:
- "링크/URL/사이트/영상 뭐 있지" → "link"
- "사진/이미지/캡쳐" → "image"
- "인용구/문장" → "quote"
- 종류를 안 가리면 null

JSON만 출력: {"topics":["..."],"type":null}`;

type Extracted = { topics: string[]; type: string | null };
const TYPES = ['text', 'link', 'image', 'quote'];

async function searchQueries(question: string): Promise<Extracted> {
  const raw = await complete([
    { role: 'system', content: EXTRACT_SYS },
    { role: 'user', content: question },
  ]);
  const p = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
  return {
    topics: Array.isArray(p?.topics)
      ? p.topics.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 3)
      : [],
    type: TYPES.includes(p?.type) ? p.type : null,
  };
}

// 게이트 판정은 사유와 함께 남긴다 (§6-4). 실패해도 삼킨다 — 로그 때문에 채팅이 죽으면 본말전도.
// 기다리지도 않는다(fire-and-forget) — 로그가 첫 토큰을 늦출 이유가 없다.
function logGate(gate: string, passed: boolean, reason: string, detail: unknown) {
  supabase
    .schema('rudy')
    .from('gate_log')
    .insert({ surface: 'chat', kind: 'resurface', gate, passed, reason, detail })
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

  // 이력은 질문과 무관하게 읽을 수 있다 — 임베딩·검색과 병렬로 (첫 토큰까지의 시간이 체감이다)
  const historyPromise = supabase
    .schema('rudy')
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  // 검색어를 뽑는다. 실패하면 질문 그대로 — 재작성이 죽어도 채팅은 살아야 한다.
  const { topics, type } = await searchQueries(question).catch((e) => {
    console.warn('[chat] 질의 재작성 실패 → 질문 원문으로 검색', e);
    return { topics: [] as string[], type: null };
  });
  // 주제어가 나오면 **그것만** 쓴다. 원문을 섞으면 메타 표현이 다시 검색을 오염시킨다
  // (실측: 원문을 섞으면 "링크 던지면 요약…"이 0.535로 1위, 빼면 "음성으로 녹음" 0.511이 1위).
  // 주제어가 없는 질문("요즘 뭐에 꽂혔어?")만 원문으로 검색한다.
  const queries = topics.length ? topics : [question];
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
  const citedIds = [...best.entries()]
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

  // 연결이 죽어도 대화는 살아야 한다 — 부가 기능이 본 기능을 인질로 잡지 않게.
  let link: Frag | null = null;
  try {
    link = await findLink(qEmbed, citedIds);
  } catch (e) {
    console.warn('[chat] 자발적 연결 실패 → 연결 없이 진행', e);
  }

  const { data: history } = await historyPromise;

  const today = new Date().toISOString().slice(0, 10);
  const evidence = cited.map((f) => fragBlock(f, projByFrag.get(f.id) ?? [])).join('\n');
  const context = [
    `<근거>\n${evidence || '(없음)'}\n</근거>`,
    link ? `<연결>\n${fragBlock(link, [])}\n</연결>` : '',
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
        push({ t: 'cite', ids: citedIds });
        if (link && utteranceId) push({ t: 'link', fragmentId: link.id, utteranceId });
        for await (const delta of chatStream(messages)) {
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
          push({ t: 'done', saved: !error });
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
