// 맥락 (2026-08-14) — 파편과 독립된 공간. 내가 직접 써 넣는 나에 대한 사실.
// 저장은 public.context_cards (supabase/context.sql), 꺼내기는 Edge Function `context`.
//
// ⚠️ 임베딩·검색이 없다. 꺼낼 때 카드 전량이 그대로 모델에 간다 — 수십 개 규모라 그게 맞다.

import { isConfigured, supabase } from './supabase';

export type ContextCard = {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  body: string;
};

const COLS = 'id, created_at, updated_at, title, body';

export async function fetchContextCards(): Promise<ContextCard[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase()
    .from('context_cards')
    .select(COLS)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as ContextCard[];
}

export async function getContextCard(id: string): Promise<ContextCard> {
  const { data, error } = await supabase()
    .from('context_cards')
    .select(COLS)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as ContextCard;
}

// 빈 카드를 만들고 바로 편집으로 보낸다 — 제목부터 물어보는 단계를 두지 않는다.
export async function createContextCard(): Promise<ContextCard> {
  const { data, error } = await supabase()
    .from('context_cards')
    .insert({})
    .select(COLS)
    .single();
  if (error) throw error;
  return data as ContextCard;
}

export async function updateContextCard(
  id: string,
  patch: { title?: string; body?: string },
): Promise<void> {
  const { error } = await supabase()
    .from('context_cards')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteContextCard(id: string): Promise<void> {
  const { error } = await supabase().from('context_cards').delete().eq('id', id);
  if (error) throw error;
}

// 요청 한 줄 → 카드 전량을 읽은 요약. 스트리밍 안 한다(복사할 한 덩어리라 흘릴 이유가 없다).
export async function summonContext(request: string): Promise<string> {
  const { data, error } = await supabase().functions.invoke('context', {
    body: { request },
  });
  // non-2xx면 supabase-js는 data를 null로 주고 본문을 error.context(Response)에 숨긴다.
  // 꺼내지 않으면 "맥락 카드가 하나도 없다" 같은 우리가 쓴 사유가 통째로 사라진다.
  if (error) {
    const res = (error as { context?: Response }).context;
    const body = res ? await res.json().catch(() => null) : null;
    throw new Error(body?.error ?? error.message);
  }
  if (!data?.text) throw new Error('빈 응답');
  return data.text as string;
}
