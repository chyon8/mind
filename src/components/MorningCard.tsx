import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { BandBar } from '@/components/MorningViz';
import { dayKey } from '@/lib/dates';
import { fetchMorningByDate, type MorningBrief } from '@/lib/morning';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 데일리 상단의 아침 카드 — **입구일 뿐 내용은 /morning에 있다.**
// 브리핑을 데일리에 통째로 펼치면 오늘 파편이 밀려나고, 그러면 데일리가 데일리가 아니게 된다.
//
// 보고 있는 날짜에 브리핑이 있으면 그 카드가 선다 — 오늘이든 지난 날이든.
// 오늘인데 아직 안 만들었으면 조용한 한 줄로만 선다. 여기서 생성하지 않는다 —
// 20초짜리 작업의 진행을 데일리에 얹으면 오늘 화면이 그동안 인질이 된다.
export function MorningCard({ date }: { date: Date }) {
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [loaded, setLoaded] = useState(false);
  const isToday = dayKey(date.toISOString()) === dayKey(new Date().toISOString());

  const load = useCallback(() => {
    fetchMorningByDate(date)
      .then((b) => {
        setBrief(b);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [date]);

  useEffect(() => {
    setLoaded(false);
    load();
  }, [load]);

  // 화면에 돌아오면 다시 읽는다 — /morning에서 만들고 나온 경우가 정확히 이 경로다.
  useEffect(() => {
    if (!isToday) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [isToday, load]);

  // 로딩 끝나기 전엔 아무 것도 안 그린다 — 안 그러면 지난 날짜에서 "아직" 카드가 잠깐 깜빡인다.
  // 지난 날짜에 브리핑이 없으면 그냥 없는 거다 — 오늘만 "아직"으로 선다.
  if (!loaded || (!brief && !isToday)) return null;

  return (
    <Pressable
      style={[styles.card, !brief && styles.cardIdle]}
      onPress={() => router.push('/morning')}
    >
      {brief ? (
        <>
          <View style={styles.head}>
            <Text style={styles.eyebrow}>아침</Text>
            <Text style={styles.chevron}>›</Text>
          </View>
          <Text style={styles.headline} numberOfLines={3}>
            {brief.headline}
          </Text>
          <BandBar bands={brief.stats.bands} />
        </>
      ) : (
        <View style={styles.idleRow}>
          <Text style={styles.eyebrow}>아침</Text>
          <Text style={styles.idle}>아직 없다</Text>
          <Text style={styles.chevron}>›</Text>
        </View>
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
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  // 아직 만들어지지 않았을 때 — 같은 카드 결에서 전체를 한 단계 죽여 "덜 와 있음"을 나타낸다.
  // 밴드 바·조용한 프로젝트 게이지와 같은 문법(opacity로 결을 뺀다), 새 모양을 안 만든다.
  // 세로 패딩만 줄인다 — 내용이 한 줄뿐이라 브리핑 카드와 같은 여백이 굳이 필요 없다.
  cardIdle: { opacity: 0.55, paddingVertical: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center' },
  idleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  eyebrow: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono, letterSpacing: 1 },
  chevron: { ...type.bodyMd, color: colors.faint, fontFamily: fonts.sans, marginLeft: 'auto' },
  headline: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium, marginTop: spacing.xxs },
  idle: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
});
