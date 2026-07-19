import AsyncStorage from '@react-native-async-storage/async-storage';
import { dayKey } from './dates';
import {
  fetchCollisionCandidates,
  fetchFragmentsByIds,
  fetchRecallPool,
  fetchRecentThrownIds,
  logGate,
  logUtterance,
  resurfacedIdsSince,
} from './supabase';
import type { Fragment } from './types';
import { vividness } from './vividness';

// 하루에 두 개. 큐도, 개수 표시도, 진행률도 없다 — 그걸 넣는 순간 생산성 앱이 되고 죽는다.
const RECALL_COUNT = 2;

// 충돌 회상 (RUDY.md §4-A1). 하루 2개 중 1개까지만 충돌이 가져간다 —
// 나머지 1개는 영원히 순수 랜덤(§4-F2 반-룹 장치). Rudy가 우연의 자리를 못 먹게.
const SEED_DAYS = 3; // 최근 며칠 던진 것을 씨앗으로 볼까
// 게이트: "충돌이라고 주장할 만한가"만 본다. 관련성 하나로만 판정한다 —
// 여기에 흐려짐·가중치를 섞으면 자주 만진 파편이 무관해도 통과한다(억지 충돌, §2-8 위반).
// 실측(2026-07-19, `check-collision.mjs --all`, 실제 코퍼스 41개 후보): 0.35는 깨끗한 경계가
// 아니었다 — teenage engineering 클러스터는 0.52~0.73으로 확실했지만, 0.30~0.34대에 무관한
// 것과 관련 있는 것이 섞여 있었다(이방성). 억지 충돌보다 놓치는 쪽이 안전하다는 §2-8 철학에
// 따라 0.42로 올림. 진짜 튜닝은 원장(§10-4) 게이트 판정 로그로 — 감으로 더 파지 않는다.
const SIM_THRESHOLD = 0.42;
// 한 번 되살린 파편은 한동안 다시 안 띄운다 (§4-A1). 같은 걸 또 보여주면 회상이 아니라 반복이다.
// 원장(rudy.utterances)이 있어야 가능한 규칙 — 그래서 §10-4 전까진 이게 없었다.
const RESURFACE_COOLDOWN_DAYS = 30;

const LEDGER = { surface: 'recall_feed', kind: 'resurface' } as const;

// 이 아래로 흐려진 것만 후보다. 이미 또렷한 걸 또 보여주는 건 낭비고,
// 회상의 가치는 "잊고 있었는데 다시 만나는 것"에 있다. (바닥은 0.25)
// 0.5는 normal tier 기준 10일+ 미접촉을 요구해 실사용 초기엔 후보가 안 생겼다 — 0.7로 완화.
const NEAR_FLOOR = 0.7;

const STORE_KEY = 'recall';

// 아직 떠올릴 만한가 — 구해냈으면 선명해졌고, 흘려보냈으면 흔적이 남는다
function stillFading(fr: Fragment, now: Date): boolean {
  return !fr.archived && fr.let_go_at == null && vividness(fr, now) <= NEAR_FLOOR;
}

// 중요할수록, 여러 번 구해냈을수록 더 자주 떠오른다.
// 중요한 게 잊히고 잡스러운 게 남는 문제가 여기서 풀린다.
function weight(fr: Fragment): number {
  return 1 + fr.touch_count * 2 + (fr.tier === 'important' ? 2 : 0);
}

function weightedSample(pool: Fragment[], n: number): Fragment[] {
  const rest = [...pool];
  const picked: Fragment[] = [];
  while (picked.length < n && rest.length > 0) {
    const total = rest.reduce((sum, fr) => sum + weight(fr), 0);
    let r = Math.random() * total;
    let i = rest.findIndex((fr) => (r -= weight(fr)) <= 0);
    if (i < 0) i = rest.length - 1; // 부동소수점 오차 방어
    picked.push(rest[i]);
    rest.splice(i, 1);
  }
  return picked;
}

// 오늘 던진 것과 의미가 부딪히는, 잊혀가던 파편 하나. 임계를 못 넘으면 null —
// 억지로 채우지 않는다(§2-8). 약한 매칭 몇 번이면 유저는 무시를 학습하고 마법이 통째로 죽는다.
async function collisionPick(now: Date): Promise<{ fr: Fragment; seedId: string } | null> {
  const seedIds = await fetchRecentThrownIds(SEED_DAYS);
  if (seedIds.length === 0) return null; // 요 며칠 던진 게 없으면 부딪힐 것도 없다

  // 쿨다운 게이트 — 최근에 이미 되살린 건 뺀다 (§6-4 ② 반복 게이트의 되살리기 판)
  const cooled = new Set(await resurfacedIdsSince(RESURFACE_COOLDOWN_DAYS));
  const fresh = (await fetchCollisionCandidates(seedIds)).filter((h) => !cooled.has(h.id));

  // 유사도 게이트 — "충돌이라 주장할 만한가". 미달이면 침묵한다(§2-8).
  const hits = fresh.filter((h) => h.similarity >= SIM_THRESHOLD);
  if (hits.length === 0) {
    logGate({
      ...LEDGER,
      gate: 'similarity',
      passed: false,
      reason: '임계 미달 — 억지로 충돌시키지 않고 침묵',
      detail: { best: fresh[0]?.similarity ?? null, threshold: SIM_THRESHOLD, pool: fresh.length },
    });
    return null;
  }

  const byId = new Map(hits.map((h) => [h.id, h]));
  const scored = (await fetchFragmentsByIds(hits.map((h) => h.id)))
    .filter((fr) => stillFading(fr, now)) // 선명도 판정은 여기서만 (감쇠 법칙의 단일 원천)
    .map((fr) => {
      const hit = byId.get(fr.id)!;
      // 게이트를 통과한 것들 중 뭘 고를까 — 흐릴수록·중요할수록 우선. 여기선 가중치를 써도 안전하다.
      return { fr, seedId: hit.seed_id, score: hit.similarity * (1 - vividness(fr, now)) * weight(fr) };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  logGate({
    ...LEDGER,
    gate: 'similarity',
    passed: !!top,
    reason: top ? '충돌 성립' : '유사도는 넘었지만 전부 아직 선명함 — 되살릴 게 없다',
    detail: {
      threshold: SIM_THRESHOLD,
      passed_sim: hits.length,
      still_vivid: hits.length - scored.length,
      picked_sim: top ? byId.get(top.fr.id)!.similarity : null,
    },
  });
  return top ?? null;
}

type Saved = {
  day: string;
  ids: string[];
  reason?: { fragmentId: string; seedId: string };
  // 충돌 발화의 원장 id — 기억하기/흘려보내기가 여기에 응답을 적는다 (§6-6)
  utteranceId?: string;
};

// 오늘 떠오른 것. 하루 안에서는 같은 파편이 계속 떠 있어야 하므로 선택을 기기에 남긴다.
// 없으면 빈 배열 — "오늘은 떠오른 게 없다" 같은 문구도 띄우지 않는다. 없으면 그냥 없는 것이다.
export async function todayRecall(): Promise<Fragment[]> {
  const now = new Date();
  const today = dayKey(now.toISOString());

  const saved = await AsyncStorage.getItem(STORE_KEY);
  if (saved) {
    const { day, ids } = JSON.parse(saved) as Saved;
    if (day === today) {
      const frs = await fetchFragmentsByIds(ids);
      return frs.filter((fr) => stillFading(fr, now)); // 손댄 건 조용히 빠진다
    }
  }

  // 충돌 1개(있으면) + 랜덤 1개. 임계 미달이면 그냥 랜덤 2개 — 슬롯을 억지로 채우지 않는다.
  // 충돌 경로가 죽어도(RPC 미배포 등) 회상 자체는 살아야 하므로 랜덤으로 폴백한다.
  let collision: { fr: Fragment; seedId: string } | null = null;
  try {
    collision = await collisionPick(now);
  } catch (e) {
    console.warn('[recall] 충돌 실패 → 랜덤만', e); // 무성 실패 방지
  }

  const pool = (await fetchRecallPool()).filter((fr) => stillFading(fr, now));
  const random = weightedSample(
    pool.filter((fr) => fr.id !== collision?.fr.id),
    RECALL_COUNT - (collision ? 1 : 0),
  );
  const picked = collision ? [collision.fr, ...random] : random;

  const next: Saved = { day: today, ids: picked.map((fr) => fr.id) };
  if (collision) {
    next.reason = { fragmentId: collision.fr.id, seedId: collision.seedId };
    // 원장에 남긴다 — 이게 30일 쿨다운의 근거이자 §6-6 성적표의 원료다.
    // 씨앗은 적지 않는다: "왜 지금"은 렌더 시점 계산이고 연결은 저장하지 않는다 (Mind SPEC §7).
    // 랜덤 픽은 루디의 발화가 아니라 우연의 자리(§4-F2)라 원장에 넣지 않는다.
    try {
      next.utteranceId = (await logUtterance({ ...LEDGER, itemIds: [collision.fr.id] })) ?? undefined;
    } catch (e) {
      console.warn('[recall] 원장 기록 실패', e); // 기록 실패로 회상을 죽이지 않는다
    }
  }
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
  return picked;
}

// 기억하기/흘려보내기가 루디의 발화에 대한 응답인지 알려준다 (§6-6 acted/dismissed).
// 랜덤으로 뜬 파편에 대한 반응은 루디에 대한 평가가 아니므로 null이다.
export async function recallUtteranceId(fragmentId: string): Promise<string | null> {
  const saved = await AsyncStorage.getItem(STORE_KEY);
  if (!saved) return null;
  const { day, reason, utteranceId } = JSON.parse(saved) as Saved;
  if (day !== dayKey(new Date().toISOString())) return null;
  return reason?.fragmentId === fragmentId ? (utteranceId ?? null) : null;
}

// "왜 지금" (§4-A1 요청 시 가시성) — 탭했을 때만 읽힌다. 평소엔 조용하다.
// 연결은 저장하지 않는다(Mind SPEC §7) — 오늘 고른 이유를 기기에 하루치 남길 뿐이다.
export async function recallSeed(): Promise<{ fragmentId: string; seed: Fragment } | null> {
  const saved = await AsyncStorage.getItem(STORE_KEY);
  if (!saved) return null;
  const { day, reason } = JSON.parse(saved) as Saved;
  if (day !== dayKey(new Date().toISOString()) || !reason) return null;
  const [seed] = await fetchFragmentsByIds([reason.seedId]);
  return seed ? { fragmentId: reason.fragmentId, seed } : null;
}
