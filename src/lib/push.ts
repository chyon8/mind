// 아침 푸시 등록 (RUDY.md §7-3 · §10-8). 발견 브리핑을 하루 1회 물어와 알리는 자리 —
// 새 화면은 안 만든다. 탭하면 기존 발견 화면(§7-4)으로 간다.
//
// 시뮬레이터·에뮬레이터에선 토큰이 안 나온다(Device.isDevice로 걸러 조용히 스킵) — 실기기에서만 동작.
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { isConfigured, supabase } from './supabase';

// 포그라운드에서 알림을 받아도 배너·소리를 보여준다 (기본값은 조용히 삼킨다).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// 권한 요청 + 토큰 발급 + 서버 등록. 실패해도 앱은 멀쩡히 돌아야 한다 — 전부 조용히 삼킨다.
export async function registerForPush(): Promise<void> {
  if (!isConfigured || !Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase()
      .schema('rudy')
      .from('push_tokens')
      .upsert({ token, updated_at: new Date().toISOString() }, { onConflict: 'token' });
  } catch (e) {
    console.warn('[push] 등록 실패', e);
  }
}

// 알림 탭 → 발견 화면으로. 앱 루트에서 한 번만 건다.
export function subscribePushTaps(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const screen = res.notification.request.content.data?.screen;
    if (screen === 'discovery') router.push('/discovery');
  });
  return () => sub.remove();
}
