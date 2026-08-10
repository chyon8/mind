import { Alert, Platform } from 'react-native';

// RN 웹에서는 Alert 버튼이 동작하지 않아 confirm으로 폴백
export function confirmDelete(message = '파편을 삭제할까? 되돌릴 수 없다.'): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) =>
    Alert.alert('삭제', message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: '삭제', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

// "다음 발견에 포함" 지정된 파편을 묻을 때 — 지정을 풀지 유지할지 고른다.
// **자동으로 풀지 않는다.** 재료 로더가 지정된 파편을 창·archived 무시하고 싣기 때문에
// (scripts/discover-claude/material.mjs) "묻어두고도 이건 파달라"가 성립하는 조합이다.
// 다만 까먹고 묻었다가 다음 브리핑에 뜬금없이 튀어나오는 쪽이 더 흔하므로, 조용히 넘어가지 않고 묻는다.
export type BuryChoice = 'release' | 'keep' | null; // null = 묻지 않는다

const BURY_MESSAGE =
  '이 파편은 다음 발견에 포함하도록 지정돼 있다. 지정을 유지하면 묻힌 뒤에도 브리핑에 나온다.';

export function confirmBuryDiscoverNext(): Promise<BuryChoice> {
  // 세 갈래라 window.confirm 하나로는 안 된다 — 묻을지 먼저 묻고, 그 다음 지정을 어쩔지 묻는다
  if (Platform.OS === 'web') {
    if (!window.confirm(`${BURY_MESSAGE}\n\n그래도 묻을까?`)) return Promise.resolve(null);
    const keep = window.confirm('발견 지정을 유지할까?\n\n확인 = 유지 · 취소 = 지정 풀기');
    return Promise.resolve(keep ? 'keep' : 'release');
  }
  return new Promise((resolve) =>
    Alert.alert('발견에 포함된 파편', BURY_MESSAGE, [
      { text: '취소', style: 'cancel', onPress: () => resolve(null) },
      { text: '지정 풀고 묻기', onPress: () => resolve('release') },
      { text: '유지하고 묻기', onPress: () => resolve('keep') },
    ]),
  );
}
