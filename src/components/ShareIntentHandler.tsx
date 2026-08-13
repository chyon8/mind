import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { router } from 'expo-router';
import { useShareIntentContext, type ShareIntent } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmDuplicateLink } from '@/lib/confirm';
import { existingFragmentContents, insertFragment, uploadImage } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import { markThrown } from '@/lib/thrown';
import { detectType } from '@/lib/typeDetector';

const MAX_EDGE = 2000; // 긴 변 2000px 이하로 다운스케일 (PLAN §4)
const TOAST_MS = 1600;

// 링크가 중복이라 사용자가 던지기를 취소한 경우 — 실패(원문 보존 후 입력 화면행)와 구분해야
// "그냥 취소했을 뿐인데 입력 화면이 뜬다"가 안 생긴다.
class ShareCancelled extends Error {}

// 공유 시트에서 Mind를 고르면 앱이 열리며 여기로 페이로드가 들어온다.
// 미리보기·확인 버튼 없이 즉시 던진다 — 잘못 던진 건 피드에서 지우면 된다 (PLAN §4).
// 단, 이미 저장된 링크면 예외적으로 확인 모달을 띄운다(중복 방지가 마찰 0보다 우선).
// 실패하면 원문을 입력 화면에 채워 보존하고 수동 재시도 (확정 결정 2).
export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [toast, setToast] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!hasShareIntent) return;

    (async () => {
      try {
        await throwShared(shareIntent);
        setToast(true);
        markThrown(); // 열려 있는 목록을 즉시 갱신 + 데일리를 오늘로 이동
      } catch (e) {
        if (e instanceof ShareCancelled) {
          // 사용자가 중복 확인에서 취소함 — 원문 보존도, 재시도 유도도 필요 없다
        } else {
          // 원문 보존 — 입력 화면에 채워서 열어준다
          const text = shareIntent.webUrl ?? shareIntent.text ?? '';
          if (text) router.push({ pathname: '/input', params: { draft: text } });
        }
      } finally {
        resetShareIntent();
      }
    })();
  }, [hasShareIntent]);

  // 토스트 숨기기는 별도 effect — 위 effect는 resetShareIntent 직후 정리되므로
  // 거기에 타이머를 두면 cleanup에 걸려 토스트가 영영 안 사라진다.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

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
    const dupes = await existingFragmentContents([intent.webUrl]).catch(() => []);
    if (dupes.length > 0 && !(await confirmDuplicateLink())) throw new ShareCancelled();
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
