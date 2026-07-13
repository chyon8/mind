import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { router } from 'expo-router';
import { useShareIntentContext, type ShareIntent } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { insertFragment, uploadImage } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import { markThrown } from '@/lib/thrown';
import { detectType } from '@/lib/typeDetector';

const MAX_EDGE = 2000; // 긴 변 2000px 이하로 다운스케일 (PLAN §4)
const TOAST_MS = 1600;

// 공유 시트에서 Mind를 고르면 앱이 열리며 여기로 페이로드가 들어온다.
// 미리보기·확인 버튼 없이 즉시 던진다 — 잘못 던진 건 피드에서 지우면 된다 (PLAN §4).
// 실패하면 원문을 입력 화면에 채워 보존하고 수동 재시도 (확정 결정 2).
export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [toast, setToast] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!hasShareIntent) return;
    let alive = true;

    (async () => {
      try {
        await throwShared(shareIntent);
        markThrown(); // 데일리 뷰가 오늘로 이동하도록
        if (!alive) return;
        setToast(true);
        setTimeout(() => alive && setToast(false), TOAST_MS);
      } catch {
        // 원문 보존 — 입력 화면에 채워서 열어준다
        const text = shareIntent.webUrl ?? shareIntent.text ?? '';
        if (alive && text) router.push({ pathname: '/input', params: { draft: text } });
      } finally {
        resetShareIntent();
      }
    })();

    return () => {
      alive = false;
    };
  }, [hasShareIntent]);

  if (!toast) return null;

  return (
    <Animated.View
      style={[styles.toast, { top: insets.top + spacing.xs }]}
      entering={FadeInUp.springify().damping(18)}
      exiting={FadeOut.duration(200)}
      pointerEvents="none"
    >
      <Text style={styles.label}>던져짐</Text>
    </Animated.View>
  );
}

async function throwShared(intent: ShareIntent): Promise<void> {
  const file = intent.files?.[0];

  // 이미지: 다운스케일 → JPEG 80% → Storage 업로드 (PLAN §4)
  if (file?.mimeType?.startsWith('image/')) {
    const ctx = ImageManipulator.manipulate(file.path);
    const longEdge = Math.max(file.width ?? 0, file.height ?? 0);
    if (longEdge > MAX_EDGE) {
      const portrait = (file.height ?? 0) >= (file.width ?? 0);
      ctx.resize(portrait ? { height: MAX_EDGE } : { width: MAX_EDGE });
    }
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    const path = await uploadImage(saved.uri, 'image/jpeg');
    await insertFragment({ content: intent.text ?? '', type: 'image', image_path: path });
    return;
  }

  // URL: 제목이 같이 오면 백필 없이 바로 저장 (PLAN §4)
  if (intent.webUrl) {
    await insertFragment({
      content: intent.webUrl,
      type: 'link',
      link_title: intent.meta?.title ?? null,
    });
    return;
  }

  const text = intent.text?.trim();
  if (!text) throw new Error('빈 공유');
  await insertFragment({ content: text, type: detectType(text) });
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.ink,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  label: { ...type.bodyMd, color: colors.onInk, fontFamily: fonts.sansMedium },
});
