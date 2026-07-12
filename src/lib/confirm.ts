import { Alert, Platform } from 'react-native';

// RN 웹에서는 Alert 버튼이 동작하지 않아 confirm으로 폴백
export function confirmDelete(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm('파편을 삭제할까? 되돌릴 수 없다.'));
  }
  return new Promise((resolve) =>
    Alert.alert('파편 삭제', '되돌릴 수 없다.', [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: '삭제', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
