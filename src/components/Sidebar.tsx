import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchProjects, type FeedFilter } from '@/lib/supabase';
import { colors, fonts, spacing, type } from '@/lib/theme';
import type { Project, ProjectStatus } from '@/lib/types';

const STATUS_ORDER: ProjectStatus[] = ['active', 'before', 'paused', 'done'];
const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '진행중',
  before: '시작전',
  paused: '중단',
  done: '완료',
};
// Things의 파이 아이콘처럼 상태를 점으로 — 진행중만 채워진다
const STATUS_DOT: Record<ProjectStatus, { color: string; filled: boolean }> = {
  active: { color: colors.ink, filled: true },
  before: { color: colors.mute, filled: false },
  paused: { color: colors.faint, filled: false },
  done: { color: colors.faint, filled: true },
};

export function Sidebar(props: { navigation: { closeDrawer: () => void } }) {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  function go(filter: FeedFilter) {
    router.setParams({ filter });
    props.navigation.closeDrawer();
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

        <Text style={styles.groupHeader}>PROJECTS</Text>
        {STATUS_ORDER.map((status) => {
          const group = projects.filter((p) => p.status === status);
          if (group.length === 0) return null;
          return (
            <View key={status}>
              <Text style={styles.statusHeader}>{STATUS_LABEL[status]}</Text>
              {group.map((p) => {
                const dot = STATUS_DOT[p.status];
                return (
                  <Pressable key={p.id} style={styles.row} onPress={() => go(p.id)}>
                    <View
                      style={[
                        styles.dot,
                        { borderColor: dot.color },
                        dot.filled && { backgroundColor: dot.color },
                      ]}
                    />
                    <Text style={[styles.rowLabel, status === 'done' && styles.doneLabel]}>
                      {p.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        <View style={styles.divider} />
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
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  rowLabel: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium },
  doneLabel: { color: colors.mute },
  groupHeader: {
    ...type.monoEyebrow,
    color: colors.faint,
    fontFamily: fonts.mono,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  statusHeader: {
    ...type.bodySm,
    color: colors.mute,
    fontFamily: fonts.sansMedium,
    marginTop: spacing.md,
    marginBottom: spacing.xxs,
    paddingHorizontal: spacing.sm,
  },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.lg,
  },
  graveLabel: { ...type.bodyLg, color: colors.mute, fontFamily: fonts.sansMedium },
});
