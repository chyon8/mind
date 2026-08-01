import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { BandBar } from '@/components/MorningViz';
import { fetchTodayMorning, type MorningBrief } from '@/lib/morning';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 데일리 상단의 아침 카드 — **입구일 뿐 내용은 /morning에 있다.**
// 브리핑을 데일리에 통째로 펼치면 오늘 파편이 밀려나고, 그러면 데일리가 데일리가 아니게 된다.
//
// 아직 안 만들었으면 조용한 한 줄로만 서 있는다. 여기서 생성하지 않는다 —
// 20초짜리 작업의 진행을 데일리에 얹으면 오늘 화면이 그동안 인질이 된다.
export function MorningCard({ visible }: { visible: boolean }) {
  const [brief, setBrief] = useState<MorningBrief | null>(null);

  const load = useCallback(() => {
    fetchTodayMorning()
      .then(setBrief)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // 화면에 돌아오면 다시 읽는다 — /morning에서 만들고 나온 경우가 정확히 이 경로다.
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [visible, load]);

  if (!visible) return null;

  return (
    <Pressable style={styles.card} onPress={() => router.push('/morning')}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>아침</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
      {brief ? (
        <>
          <Text style={styles.headline} numberOfLines={3}>
            {brief.headline}
          </Text>
          <BandBar bands={brief.stats.bands} />
        </>
      ) : (
        <Text style={styles.idle}>오늘 아침을 아직 안 읽었다</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    padding: spacing.card,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono, letterSpacing: 1 },
  chevron: { ...type.bodyMd, color: colors.faint, fontFamily: fonts.sans, marginLeft: 'auto' },
  headline: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium },
  idle: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
});
