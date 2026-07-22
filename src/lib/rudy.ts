// Rudy 채팅 클라이언트 (RUDY.md §4-C1 · §7-2, §10-5).
// 스트리밍이라 supabase-js의 functions.invoke를 못 쓴다 — 그건 응답을 통째로 모아서 준다.
// expo/fetch는 RN에서 response.body(ReadableStream)를 주는 유일한 경로다.
import { fetch as streamingFetch } from 'expo/fetch';
import { lineFeeder } from './ndjson';
import { isConfigured, supabase } from './supabase';

const FUNCTIONS_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/chat`;
const DISCOVERY_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/discovery`;

// 발견 브리핑 (RUDY.md §4-E · §7-4). NDJSON 스트리밍 — 조립이 gpt-5.5 대용량이라 30~60초인데,
// 단계(status)와 토큰(d)이 흘러나와 앱이 진행을 보여준다("너무 오래 걸려" 체감 완화).
// done의 empty=true면 "오늘은 볼 게 없음"(§2-8 빈 브리핑 허용).
// 지난 브리핑들 (원장에 저장된 것). 날짜별 기록·재생성 회피에 쓴다.
// 화면을 열 때마다 새로 만들지 않고 최근 것을 읽어 온다 — 매번 60초·비용을 안 쓰게.
// trigger: 'pull' = 화면에서 직접 생성 / 'push' = 아침 배치가 생성. 기록 목록의 구분 표시용.
export type Briefing = {
  id: string;
  created_at: string;
  text: string;
  trigger: 'pull' | 'push';
  cost_usd: number | null; // 2026-07-22 — 이 브리핑이 gpt-5.5를 2번(각도·조립) 태운 실제 비용
};
export async function fetchBriefings(): Promise<Briefing[]> {
  const { data, error } = await supabase()
    .schema('rudy')
    .from('utterances')
    .select('id, created_at, text, trigger, cost_usd')
    .eq('kind', 'discovery')
    .eq('surface', 'briefing')
    .not('text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []).filter((b) => (b.text ?? '').trim()) as Briefing[];
}

// 기록에서 지우기 — 사후 폐기. 생성 중 취소 대신 이걸 쓴다(항상 저장된다는 원칙과 안 싸운다).
export async function deleteBriefing(id: string): Promise<void> {
  const { error } = await supabase().schema('rudy').from('utterances').delete().eq('id', id);
  if (error) throw error;
}

export type BriefStage = 'reading' | 'angles' | 'search' | 'writing';
type BriefHandlers = {
  onStage: (stage: BriefStage, count?: number) => void;
  onToken: (text: string) => void;
};

export async function streamBriefing(
  h: BriefHandlers,
  signal?: AbortSignal,
): Promise<{ empty: boolean; costUsd: number | null }> {
  if (!isConfigured) throw new Error('Supabase 미설정');
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('세션 없음');

  const res = await streamingFetch(DISCOVERY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`discovery ${res.status}`);

  let empty = false;
  let costUsd: number | null = null;
  let failure = '';
  const feeder = lineFeeder((raw) => {
    const ev = JSON.parse(raw);
    if (ev.t === 'status') h.onStage(ev.stage, ev.count);
    else if (ev.t === 'd') h.onToken(ev.c);
    else if (ev.t === 'done') {
      empty = ev.empty;
      costUsd = ev.costUsd ?? null;
    } else if (ev.t === 'error') failure = ev.message;
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    feeder.push(decoder.decode(value, { stream: true }));
  }
  feeder.end();

  if (failure) throw new Error(failure);
  return { empty, costUsd };
}

export type ChatMessage = {
  id: string;
  created_at: string;
  role: 'user' | 'assistant';
  content: string;
  cited_ids: string[];
  cost_usd: number | null; // 2026-07-22 — 이 답변 하나가 태운 gpt 호출 전부(재작성·판정·라벨·본답변) 합계
};

export type Conversation = { id: string; created_at: string; title: string | null };

// 대화 목록 — 채팅 홈에서 골라 들어간다
export async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase()
    .schema('rudy')
    .from('conversations')
    .select('id, created_at, title')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

// 대화 행은 첫 질문을 보낼 때 만든다(지연 생성). 화면을 열 때 만들면
// `새로 채팅`을 누르고 나간 것만으로 빈 대화가 기록에 쌓인다.
export async function newConversation(): Promise<string> {
  const { data, error } = await supabase()
    .schema('rudy')
    .from('conversations')
    .insert({})
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

// messages는 on delete cascade — 대화를 지우면 그 안의 말도 같이 간다.
// 파편은 건드리지 않는다. 여긴 대화 기록일 뿐이다.
export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase().schema('rudy').from('conversations').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase()
    .schema('rudy')
    .from('messages')
    .select('id, created_at, role, content, cited_ids, cost_usd')
    .eq('conversation_id', conversationId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

type Handlers = {
  onToken: (text: string) => void;
  // 근거 파편 id — 스트림 맨 앞에 온다. 저장이 실패해도 근거 칩은 그릴 수 있어야 한다.
  onCite: (ids: string[]) => void;
  // 자발적 연결 — 묻지 않았는데 걸어 들어온 파편. utteranceId는 반응(§6-6)을 적을 자리.
  onLink: (fragmentId: string, utteranceId: string) => void;
  // 바깥(웹)을 뒤졌다 — 앱이 "바깥에서 찾아봤다"를 표시한다.
  onWeb?: () => void;
};

// 질문 하나를 보내고 토큰을 흘려받는다. 이력 저장은 서버가 한다 —
// 스트리밍 도중 앱이 죽어도 대화가 남아야 하므로.
//
// 반환값 = 서버가 이력 저장까지 끝냈는지. false면 화면의 답을 지우면 안 된다 —
// 다시 읽어도 거기 없어서 답이 통째로 증발한다.
// signal로 중단할 수 있다 — 중단하면 AbortError가 던져지고, 서버는 부분 답까지 저장한다.
export async function askRudy(
  conversationId: string,
  question: string,
  h: Handlers,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!isConfigured) throw new Error('Supabase 미설정 — 채팅은 픽스처 모드에서 동작하지 않는다');

  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('세션 없음');

  const res = await streamingFetch(FUNCTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, question }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);

  let saved = false;
  let failure = '';
  const feeder = lineFeeder((raw) => {
    const ev = JSON.parse(raw);
    if (ev.t === 'd') h.onToken(ev.c);
    else if (ev.t === 'cite') h.onCite(ev.ids);
    else if (ev.t === 'link') h.onLink(ev.fragmentId, ev.utteranceId);
    else if (ev.t === 'web') h.onWeb?.();
    else if (ev.t === 'done') saved = ev.saved;
    // 여기서 바로 throw하지 않는다 — 뒤따라올 done을 못 읽어서, 서버가 멀쩡히 저장한
    // 부분 답변까지 "저장 안 됨"으로 취급하게 된다. 다 읽고 나서 판단한다.
    else if (ev.t === 'error') failure = ev.message;
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // stream:true — 한글은 3바이트라 청크 경계에서 글자가 쪼개진다
    feeder.push(decoder.decode(value, { stream: true }));
  }
  feeder.end(); // 마지막 줄이 개행 없이 닫혔을 때 — 안 흘리면 끝이 잘린다 (ndjson.ts 참고)

  if (failure && !saved) throw new Error(failure);
  return saved;
}
