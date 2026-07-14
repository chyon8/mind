import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FragmentCard } from '@/components/FragmentCard';
import { feedDateLabel } from '@/lib/dates';
import { searchFragments } from '@/lib/supabase';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { vividness } from '@/lib/vividness';

// 검색은 별도 화면이 아니라 홈 위에 제자리에서 열리는 레이어.
// 헤더 자리에 검색바가 스르륵 내려오고, 결과는 같은 화면에서 바로 보인다.
// 검색은 찾으러 들어온 행위 — 감쇠와 무관하게 결과는 전부 선명하게 보여준다.
// 대신 원래 얼마나 흐린 파편이었는지는 카드 opacity로 남긴다.
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Fragment[]>([]);
  // absolute 자식은 부모(SafeAreaView)의 padding을 무시하고 화면 맨 위부터 그려진다.
  // 그래서 safe area를 여기서 직접 얹어준다 — 안 그러면 상태바 밑에 깔려 터치도 안 먹는다.
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchFragments(q).then(setResults).catch(() => setResults([]));
    }, 200); // 타이핑 중 과다 조회 방지
    return () => clearTimeout(t);
  }, [q]);

  const now = new Date();

  function open(id: string) {
    onClose();
    router.push(`/fragment/${id}`);
  }

  return (
    <Animated.View
      style={[styles.overlay, { paddingTop: insets.top }]}
      entering={FadeIn.duration(140)}
      exiting={FadeOut.duration(120)}
    >
      <Animated.View style={styles.bar} entering={FadeInDown.duration(200)}>
        <Text style={styles.glyph}>⌕</Text>
        <TextInput
          style={[styles.input, noFocusRing]}
          value={q}
          onChangeText={setQ}
          autoFocus
          placeholder="파편 찾기"
          placeholderTextColor={colors.faint}
          keyboardAppearance="dark"
          returnKeyType="search"
        />
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </Animated.View>

      {q.trim() !== '' && results.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>찾지 못했다</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(fr) => fr.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" // 결과를 훑어 내리면 키보드가 비켜준다
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => open(item.id)} style={styles.row}>
              <Text style={styles.date}>
                {feedDateLabel(item.created_at)}
                {item.archived ? ' · 무덤' : ''}
              </Text>
              <FragmentCard
                fragment={item}
                opacity={vividness(item, now)}
              />
            </Pressable>
          )}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.canvas,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
  },
  glyph: { fontSize: 18, color: colors.faint },
  input: {
    flex: 1,
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    paddingVertical: spacing.xs,
  },
  close: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sansMedium },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  row: { marginBottom: spacing.sm },
  date: {
    ...type.monoEyebrow,
    color: colors.faint,
    fontFamily: fonts.mono,
    marginBottom: spacing.xxs,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
});
