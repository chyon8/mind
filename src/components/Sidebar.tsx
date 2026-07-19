import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { FeedFilter } from '@/lib/supabase';
import { colors, fonts, spacing, type } from '@/lib/theme';

// All · Inbox · 고정 · 프로젝트 / 헤매기 · 무덤 (PLAN.md §6.2)
// 프로젝트의 상태별 분류는 프로젝트 목록 화면의 칩이 담당한다.
export function Sidebar(props: { navigation: { closeDrawer: () => void } }) {
  function go(filter: FeedFilter) {
    router.setParams({ filter });
    props.navigation.closeDrawer();
  }

  function goProjects() {
    props.navigation.closeDrawer();
    router.push('/projects');
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.wordmark}>MIND</Text>

        <Pressable style={styles.row} onPress={() => go('all')}>
          <Text style={styles.rowLabel}>All</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => go('inbox')}>
          <Text style={styles.rowLabel}>Inbox</Text>
        </Pressable>
        {/* 즐겨찾기 = tier가 pinned인 것들. 새 개념이 아니라 렌즈다. */}
        <Pressable style={styles.row} onPress={() => go('pinned')}>
          <Text style={styles.rowLabel}>고정</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={goProjects}>
          <Text style={styles.rowLabel}>프로젝트</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <View style={styles.divider} />
        {/* 당기는 표면 (RUDY.md §7-2) — 내가 열 때만 말한다 */}
        <Pressable
          style={styles.row}
          onPress={() => {
            props.navigation.closeDrawer();
            router.push('/chat');
          }}
        >
          <Text style={styles.rowLabel}>Rudy</Text>
        </Pressable>
        {/* 판단 없는 자리 — 그냥 무작위로 흘러나온다 */}
        <Pressable
          style={styles.row}
          onPress={() => {
            props.navigation.closeDrawer();
            router.push('/wander');
          }}
        >
          <Text style={styles.rowLabel}>헤매기</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => go('grave')}>
          <Text style={styles.graveLabel}>무덤</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  scroll: { padding: spacing.md, paddingTop: spacing.lg },
  wordmark: {
    ...type.monoEyebrow,
    color: colors.mute,
    fontFamily: fonts.mono,
    letterSpacing: 2,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  rowLabel: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium },
  chevron: { ...type.bodyLg, color: colors.faint, fontFamily: fonts.sans },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.lg,
  },
  graveLabel: { ...type.bodyLg, color: colors.mute, fontFamily: fonts.sansMedium },
});
