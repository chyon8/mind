import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FragmentCard } from '@/components/FragmentCard';
import { feedDateLabel } from '@/lib/dates';
import { searchFragments, type SearchType } from '@/lib/supabase';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { vividness } from '@/lib/vividness';

const FILTERS: { value: SearchType; label: string }[] = [
  { value: null, label: '전체' },
  { value: 'text', label: '텍스트' },
  { value: 'link', label: '링크' },
  { value: 'image', label: '이미지' },
  { value: 'quote', label: '인용' },
];

// 검색은 별도 화면이 아니라 홈 위에 제자리에서 열리는 레이어.
// 헤더 자리에 검색바가 스르륵 내려오고, 결과는 같은 화면에서 바로 보인다.
// 검색은 찾으러 들어온 행위 — 감쇠와 무관하게 결과는 전부 선명하게 보여준다.
// 대신 원래 얼마나 흐린 파편이었는지는 카드 opacity로 남긴다.
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<SearchType>(null);
  const [results, setResults] = useState<Fragment[]>([]);
  const [loading, setLoading] = useState(false);
  // absolute 자식은 부모(SafeAreaView)의 padding을 무시하고 화면 맨 위부터 그려진다.
  // 그래서 safe area를 여기서 직접 얹어준다 — 안 그러면 상태바 밑에 깔려 터치도 안 먹는다.
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false; // 느린 응답이 새 질의 결과를 덮어쓰지 못하게 (네트워크 검색이라 순서 역전 가능)
    const t = setTimeout(() => {
      searchFragments(query, filter)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false));
    }, 200); // 타이핑 중 과다 조회 방지
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, filter]);

  const now = new Date();

  // 결과를 열 때 오버레이를 닫지 않는다 — 홈 위에 살아있으므로 뒤로가기하면 검색 결과가 그대로 있다.
  function open(id: string) {
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
        {loading && <ActivityIndicator size="small" color={colors.faint} />}
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </Animated.View>

      <View style={styles.chipRow}>
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <Pressable
              key={f.value ?? 'all'}
              onPress={() => setFilter(f.value)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading && results.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.mute} />
        </View>
      ) : q.trim() !== '' && !loading && results.length === 0 ? (
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
              <FragmentCard fragment={item} opacity={vividness(item, now)} />
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  chip: {
    alignSelf: 'flex-start', // 세로로 늘어나지 않게 (내용 높이만)
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  chipLabelActive: { color: colors.onInk },
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
