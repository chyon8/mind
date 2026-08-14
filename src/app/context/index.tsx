import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createContextCard, fetchContextCards, type ContextCard } from '@/lib/context';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 맥락 목록 — 내가 직접 써 넣는 나에 대한 사실 (supabase/context.sql).
// 파편과 완전히 독립이다: 선명도·회상·발견·임베딩 어디에도 안 걸린다.
//
// 목록 순서는 만든 순 고정. 처음 앉아서 채워 넣은 순서가 곧 배치라 정렬 기능을 두지 않는다.
export default function ContextList() {
  const [cards, setCards] = useState<ContextCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchContextCards()
      .then((cs) => {
        setCards(cs);
        setError(null);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);
  useFocusEffect(load);

  async function create() {
    const card = await createContextCard();
    router.push(`/context/${card.id}`);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBtn}>‹ 뒤로</Text>
        </Pressable>
        <Text style={styles.wordmark}>CONTEXT</Text>
        <Pressable onPress={create} hitSlop={12}>
          <Text style={styles.plus}>＋</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {/* 꺼내기가 이 공간의 목적이라 목록보다 위에 둔다 — 채우는 건 처음 한 번이고
            꺼내는 건 계속이다. */}
        <Pressable style={styles.summon} onPress={() => router.push('/context/summon')}>
          <Text style={styles.summonText}>맥락 꺼내기</Text>
          <Text style={styles.summonSub}>요청한 대로 정리해서 준다 — 다른 AI에 붙여넣을 것</Text>
        </Pressable>

        {error && <Text style={styles.errorText}>불러오기 실패: {error}</Text>}
        {!error && cards.length === 0 && (
          <Text style={styles.empty}>
            아직 비어 있다 — 위 ＋로 프로젝트·커리어·좋아하는 것을 하나씩 넣는다
          </Text>
        )}

        {cards.map((c) => (
          <Pressable
            key={c.id}
            style={styles.row}
            onPress={() => router.push(`/context/${c.id}`)}
          >
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {c.title || '제목 없음'}
              </Text>
              <Text style={styles.rowPreview} numberOfLines={1}>
                {c.body.replace(/\s+/g, ' ').trim() || '비어 있음'}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  headerBtn: { ...type.labelSm, color: colors.mute, fontFamily: fonts.sans },
  wordmark: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },
  plus: { fontSize: 22, color: colors.ink },

  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.xxs },
  summon: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xxs,
    marginBottom: spacing.sm,
  },
  summonText: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansSemiBold },
  summonSub: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairlineSoft,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium },
  rowPreview: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  chevron: { ...type.bodyLg, color: colors.faint, fontFamily: fonts.sans },
  empty: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans, marginTop: spacing.md },
  errorText: { ...type.bodySm, color: colors.error, fontFamily: fonts.sans },
});
