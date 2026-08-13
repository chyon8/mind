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

// 이미 던진 링크를 또 던지려 할 때 — 입력 화면(명시적 던지기)에서만 묻는다.
// 공유받아 자동 저장되는 흐름(ShareIntentHandler)은 즉시 저장이 확정 결정이라 여기 안 걸린다.
export function confirmDuplicateLink(message = '이미 저장한 링크야. 그래도 던질까?'): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) =>
    Alert.alert('중복된 링크', message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: '그래도 던지기', onPress: () => resolve(true) },
    ]),
  );
}
