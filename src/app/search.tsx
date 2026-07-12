import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FragmentCard } from '@/components/FragmentCard';
import { feedDateLabel } from '@/lib/dates';
import { searchFragments } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { opacity } from '@/lib/vividness';

// 검색은 찾으러 들어온 행위 — 감쇠와 무관하게 결과는 전부 선명하게 보여준다.
// 대신 원래 얼마나 흐린 파편이었는지는 카드 opacity로 남긴다.
export default function Search() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Fragment[]>([]);

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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          autoFocus
          placeholder="파편 찾기"
          placeholderTextColor={colors.faint}
          keyboardAppearance="dark"
          returnKeyType="search"
        />
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>닫기</Text>
        </Pressable>
      </View>

      {q.trim() !== '' && results.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>찾지 못했다</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(fr) => fr.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/fragment/${item.id}`)} style={styles.row}>
              <Text style={styles.date}>
                {feedDateLabel(item.created_at)}
                {item.archived ? ' · 무덤' : ''}
              </Text>
              <FragmentCard
                fragment={item}
                opacity={opacity(new Date(item.last_touched_at), item.tier, now)}
              />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  input: {
    flex: 1,
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  cancel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
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
