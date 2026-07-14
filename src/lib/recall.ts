import AsyncStorage from '@react-native-async-storage/async-storage';
import { dayKey } from './dates';
import { fetchFragmentsByIds, fetchRecallPool } from './supabase';
import type { Fragment } from './types';
import { vividness } from './vividness';

// 하루에 두 개. 큐도, 개수 표시도, 진행률도 없다 — 그걸 넣는 순간 생산성 앱이 되고 죽는다.
const RECALL_COUNT = 2;

// 이 아래로 흐려진 것만 후보다. 이미 또렷한 걸 또 보여주는 건 낭비고,
// 회상의 가치는 "잊고 있었는데 다시 만나는 것"에 있다. (바닥은 0.25)
const NEAR_FLOOR = 0.5;

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

// 오늘 떠오른 것. 하루 안에서는 같은 파편이 계속 떠 있어야 하므로 선택을 기기에 남긴다.
// 없으면 빈 배열 — "오늘은 떠오른 게 없다" 같은 문구도 띄우지 않는다. 없으면 그냥 없는 것이다.
export async function todayRecall(): Promise<Fragment[]> {
  const now = new Date();
  const today = dayKey(now.toISOString());

  const saved = await AsyncStorage.getItem(STORE_KEY);
  if (saved) {
    const { day, ids } = JSON.parse(saved) as { day: string; ids: string[] };
    if (day === today) {
      const frs = await fetchFragmentsByIds(ids);
      return frs.filter((fr) => stillFading(fr, now)); // 손댄 건 조용히 빠진다
    }
  }

  const pool = await fetchRecallPool();
  const picked = weightedSample(
    pool.filter((fr) => stillFading(fr, now)),
    RECALL_COUNT,
  );
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ day: today, ids: picked.map((fr) => fr.id) }));
  return picked;
}
