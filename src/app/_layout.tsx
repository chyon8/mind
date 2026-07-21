import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  useFonts,
} from '@expo-google-fonts/geist';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { Stack } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Login } from '@/components/Login';
import { ShareIntentHandler } from '@/components/ShareIntentHandler';
import { backfillLinkMeta } from '@/lib/linkMeta';
import { registerForPush, subscribePushTaps } from '@/lib/push';
import { hasSession, onAuthChange } from '@/lib/supabase';
import { colors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_500Medium,
  });
  const [signedIn, setSignedIn] = useState<boolean | null>(null); // null = 세션 확인 중

  useEffect(() => {
    hasSession().then(setSignedIn);
    return onAuthChange(setSignedIn);
  }, []);

  useEffect(() => {
    if (fontsLoaded && signedIn !== null) SplashScreen.hideAsync();
  }, [fontsLoaded, signedIn]);

  // 포그라운드 진입 시 링크 제목 백필 (PLAN §3.6) — 로그인 후에만 의미가 있다
  useEffect(() => {
    if (!signedIn) return;
    backfillLinkMeta();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') backfillLinkMeta();
    });
    return () => sub.remove();
  }, [signedIn]);

  // 아침 푸시 등록 + 탭 라우팅 (§7-3). 로그인 후에만 — 세션 있어야 토큰을 저장할 수 있다.
  useEffect(() => {
    if (!signedIn) return;
    registerForPush();
    return subscribePushTaps();
  }, [signedIn]);

  if (!fontsLoaded || signedIn === null) return null;
  if (!signedIn) return <Login />;

  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.canvas },
            }}
          >
            <Stack.Screen name="(drawer)" />
            {/* 가운데 카드 모달 — 등장/퇴장 애니메이션은 input.tsx가 직접 그린다 */}
            <Stack.Screen
              name="input"
              options={{
                presentation: 'transparentModal',
                animation: 'none',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen name="fragment/[id]" />
            <Stack.Screen name="chat" />
            <Stack.Screen name="discovery" />
          </Stack>
          <ShareIntentHandler />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
