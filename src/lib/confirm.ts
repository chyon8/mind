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
