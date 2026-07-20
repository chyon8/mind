// 늦은 의도 (RUDY.md §4-F1 · §10-6+).
//
// 저장할 땐 아무것도 묻지 않는다(§2-7 마찰 0). 대신 나중에 대화에서 가볍게 묻고,
// 답이 오면 그것만 저장한다 — **유저의 자기 진술은 최고 품질 증거다(§4-B2).**
//
// ⚠️ 세 갈래(설명 없는 링크 / 고아 파편 / 축의 의도 불명)를 따로 만들지 않았다.
//    실제로 다른 건 정렬 키뿐이라 후보 풀 하나에 우선순위만 둔다:
//      ① 축에 묶였는데 의도 불명 — 답 하나가 축 전체를 추측에서 확인으로 올린다
//      ② 설명 없는 최근 파편 — 하나만 설명하지만 **최근이라 유저가 실제로 기억한다**
//      ③ 오래된 고아 — 물어도 유저가 답을 모른다. 후보엔 있지만 항상 꼴찌다.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { complete, embed } from '../_shared/openai.ts';
import { kstDate } from '../_shared/time.ts';

const WINDOW_DAYS = 30; // 이보다 오래된 건 물어도 기억을 못 한다
const CAPTURE_HOURS = 24; // 이 시간이 지난 질문은 답을 기다리지 않는다

export type Target = { id: string; created_at: string; type: string; content: string; link_title: string | null };

const TARGET_COLS = 'id, created_at, type, content, link_title';

/**
 * 지금 물어볼 파편 하나. 없으면 null (침묵 기본값 §2-8 — 물을 게 없으면 안 묻는다).
 *
 * 예산 검사를 **제일 먼저** 한다. 하루 1개를 이미 물었으면 나머지 조회를 아예 안 돈다 —
 * 이 함수는 매 턴 불리므로, 비싼 일이 하루 한 번만 돌게 하는 게 순서로 강제된다.
 */
export async function pickQuestion(
  supabase: SupabaseClient,
  axisIds: Set<string>,
  log: (gate: string, passed: boolean, reason: string, detail: unknown) => void,
): Promise<Target | null> {
  // ① 예산 (§6-4 ⑤). 먼저 거는 말이므로 채팅 응답과 달리 상한이 있다.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { count: askedToday } = await supabase
    .schema('rudy')
    .from('utterances')
    .select('*', { count: 'exact', head: true })
    .eq('kind', 'question')
    .gte('created_at', dayStart.toISOString());
  if (askedToday) {
    log('budget', false, '오늘 이미 물었다 — 하루 1개', { askedToday });
    return null;
  }

  // ② 같은 파편을 두 번 묻지 않는다 (§2-2). 원장이 그대로 쿨다운이 된다 —
  //    자발적 연결이 resurface 원장을 재사용해 중복을 공짜로 막은 것과 같은 수법.
  const { data: asked } = await supabase
    .schema('rudy')
    .from('utterances')
    .select('item_ids')
    .eq('kind', 'question');
  const askedIds = new Set((asked ?? []).flatMap((r) => (r.item_ids ?? []) as string[]));

  // ③ 후보 = 설명이 없는 파편. 덧(note)이 있으면 왜 저장했는지 이미 적혀 있다.
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data: rows } = await supabase
    .from('fragments')
    .select(TARGET_COLS)
    .eq('archived', false)
    .is('note', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  // 프로젝트에 묶인 건 맥락이 이미 있다 — 물을 이유가 약하다.
  const { data: inProjects } = await supabase.from('fragment_projects').select('fragment_id');
  const grouped = new Set((inProjects ?? []).map((r) => r.fragment_id as string));

  const pool = ((rows ?? []) as Target[]).filter(
    (f) => !askedIds.has(f.id) && !grouped.has(f.id),
  );
  if (!pool.length) {
    log('evidence', false, '물어볼 후보 없음', { window: WINDOW_DAYS, asked: askedIds.size });
    return null;
  }

  // ④ 정렬: 축에 묶인 것 먼저, 그다음 최신순 (rows가 이미 최신순이라 안정 정렬로 유지된다).
  const target = pool.find((f) => axisIds.has(f.id)) ?? pool[0];
  log('evidence', true, axisIds.has(target.id) ? '축에 묶인 파편' : '설명 없는 최근 파편', {
    pool: pool.length,
    inAxis: axisIds.has(target.id),
    ageDays: Math.round((Date.now() - new Date(target.created_at).getTime()) / 86_400_000),
  });
  return target;
}

// 질문을 원장에 적는다. text는 비운다 — 실제 문장은 모델이 답변 안에서 짓기 때문에
// 우리가 모른다. 자발적 연결에서 "연결을 건넸다"까지만 기록한 것과 같은 판단이다.
export async function logQuestion(supabase: SupabaseClient, target: Target): Promise<void> {
  const { error } = await supabase
    .schema('rudy')
    .from('utterances')
    .insert({ surface: 'chat', kind: 'question', item_ids: [target.id] });
  if (error) console.warn('[intent] 질문 기록 실패', error);
}

const JUDGE_SYS = `루디가 사용자에게 "이 파편을 왜 저장했냐"고 물었다.
사용자의 다음 메시지가 **그 질문에 대한 답**인지 판정한다.

- 의도·이유·계획을 말했으면 답이다 ("케이스랩 만들려고", "그냥 예뻐서")
- 새 질문을 했거나 다른 주제로 넘어갔으면 답이 아니다
- "몰라", "그냥"도 답이다 (의도가 없었다는 진술)

JSON만 출력: {"isAnswer": true}`;

/**
 * 직전 질문에 대한 답이면 잡아서 저장한다.
 *
 * ⚠️ 저장되는 문장은 **유저가 쓴 그대로**다. 모델은 "답인가"만 판정하고 문장은 안 만진다 —
 *    요약·정규화하는 순간 그건 유저의 진술이 아니라 루디의 해석이 되고, §2-1을 넘는다.
 */
export async function captureAnswer(
  supabase: SupabaseClient,
  message: string,
  log: (gate: string, passed: boolean, reason: string, detail: unknown) => void,
): Promise<Target | null> {
  const since = new Date(Date.now() - CAPTURE_HOURS * 3_600_000).toISOString();
  const { data: pending } = await supabase
    .schema('rudy')
    .from('utterances')
    .select('id, item_ids')
    .eq('kind', 'question')
    .is('user_response', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pending) return null; // 대기 중인 질문이 없으면 비용 0

  const ids = (pending.item_ids ?? []) as string[];
  const { data: frag } = await supabase
    .from('fragments')
    .select(TARGET_COLS)
    .eq('id', ids[0])
    .maybeSingle();

  const target = frag as Target | null;
  const raw = await complete([
    { role: 'system', content: JUDGE_SYS },
    {
      role: 'user',
      content: `루디가 물어본 파편: ${target ? questionSubject(target) : '(삭제됨)'}\n사용자 메시지: ${message}`,
    },
  ]);
  const isAnswer = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim())?.isAnswer === true;
  log('confidence', isAnswer, isAnswer ? '자기 진술 포착' : '질문의 답이 아님', {
    utteranceId: pending.id,
  });
  if (!isAnswer) return null;

  const vector = await embed(message).catch((e) => {
    console.warn('[intent] 진술 임베딩 실패 — 진술은 저장한다', e);
    return null;
  });
  const { error } = await supabase
    .schema('rudy')
    .from('evidence')
    .insert({
      stated_text: message, // 유저의 말 그대로
      related_item_ids: ids,
      embedding: vector,
      utterance_id: pending.id,
    });
  if (error) {
    console.warn('[intent] 진술 저장 실패', error);
    return null;
  }
  // 답했다 = acted (§6-6 응답 캡처 정의)
  await supabase
    .schema('rudy')
    .from('utterances')
    .update({ user_response: 'acted', responded_at: new Date().toISOString() })
    .eq('id', pending.id)
    .then(undefined, (e) => console.warn('[intent] 응답 기록 실패', e));

  // ⚠️ 캡처했다는 사실을 호출부에 돌려준다. 저장만 하고 대화에 반영하지 않으면
  //    루디는 자기가 물어놓고 답을 못 들은 것처럼 군다 — 실제로 유저의 답을 새 질문으로
  //    착각해 보고서를 냈다 (2026-07-20). 답을 받았으면 답을 받은 것처럼 말해야 한다.
  return target;
}

// 모델에 넘길 질문 대상. 링크는 제목이, 생각은 본문이 곧 정체다.
export function questionSubject(f: Target): string {
  const title = (f.type === 'link' ? f.link_title ?? f.content : f.content) ?? '';
  return `${kstDate(f.created_at)} | ${title.replace(/\n/g, ' ').slice(0, 80)} | id: ${f.id}`;
}
