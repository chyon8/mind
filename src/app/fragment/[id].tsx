import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmDelete } from '@/lib/confirm';
import { feedDateLabel, formatTime } from '@/lib/dates';
import {
  deleteFragment,
  fetchProjects,
  getFragment,
  setFragmentProjects,
  touchFragment,
  updateFragment,
} from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment, Project, Tier } from '@/lib/types';

const TIERS: { value: Tier; label: string }[] = [
  { value: 'normal', label: '보통' },
  { value: 'important', label: '중요' },
  { value: 'pinned', label: '고정' },
];

// 화면 4: 원문 전체 + tier 토글 + 프로젝트 붙이기 + 묻기 + 삭제.
// 열리는 순간 touch → 선명도 100% 복귀 (SPEC §6-4)
export default function FragmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [fragment, setFragment] = useState<Fragment | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!id) return;
    touchFragment(id).catch(() => {}); // touch 실패해도 열람은 계속
    fetchProjects().then(setProjects).catch(() => {});
  }, [id]);

  // 수정 화면에서 돌아올 때 최신 내용 반영
  useFocusEffect(
    useCallback(() => {
      if (id) getFragment(id).then(setFragment).catch(() => {});
    }, [id]),
  );

  if (!fragment) return <SafeAreaView style={styles.screen} />;

  async function patch(p: Partial<Omit<Fragment, 'project_ids'>>) {
    await updateFragment(fragment!.id, p);
    setFragment({ ...fragment!, ...p });
  }

  // 프로젝트는 태그 — 여러 개 동시에 붙는다 (PLAN.md §3.3)
  async function toggleProject(projectId: string | null) {
    const current = fragment!.project_ids;
    const next =
      projectId === null
        ? [] // Inbox = 매핑 전부 해제
        : current.includes(projectId)
          ? current.filter((pid) => pid !== projectId)
          : [...current, projectId];
    await setFragmentProjects(fragment!.id, next);
    setFragment({ ...fragment!, project_ids: next });
  }

  async function remove() {
    if (!(await confirmDelete())) return;
    await deleteFragment(fragment!);
    router.back();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBtn}>‹ 뒤로</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: '/input', params: { id: fragment.id } })}
          hitSlop={12}
        >
          <Text style={styles.headerBtn}>수정</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.meta}>
          {fragment.type.toUpperCase()} · {feedDateLabel(fragment.created_at)}{' '}
          {formatTime(fragment.created_at)}
        </Text>

        <Text style={styles.content}>{fragment.content}</Text>
        {fragment.link_title && <Text style={styles.linkTitle}>{fragment.link_title}</Text>}

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>TIER</Text>
        <View style={styles.tierRow}>
          {TIERS.map((t) => {
            const active = fragment.tier === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => patch({ tier: t.value })}
                style={[styles.tierBtn, active && styles.tierBtnActive]}
              >
                <Text style={[styles.tierLabel, active && styles.tierLabelActive]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>PROJECT</Text>
        <View style={styles.projectRow}>
          {[{ id: null as string | null, name: 'Inbox' }, ...projects].map((p) => {
            const active =
              p.id === null
                ? fragment.project_ids.length === 0
                : fragment.project_ids.includes(p.id);
            return (
              <Pressable
                key={p.id ?? 'inbox'}
                onPress={() => toggleProject(p.id)}
                style={[styles.projectChip, active && styles.projectChipActive]}
              >
                <Text style={[styles.projectLabel, active && styles.projectLabelActive]}>
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        <Pressable
          onPress={() => patch({ archived: !fragment.archived })}
          style={styles.graveBtn}
        >
          <Text style={styles.graveLabel}>
            {fragment.archived ? '파내기 — 타임라인으로 복귀' : '묻기 — 무덤으로'}
          </Text>
        </Pressable>

        <Pressable onPress={remove} style={styles.deleteBtn}>
          <Text style={styles.deleteLabel}>삭제</Text>
        </Pressable>
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
  headerBtn: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxxl },
  meta: {
    ...type.monoEyebrow,
    color: colors.mute,
    fontFamily: fonts.mono,
    marginBottom: spacing.lg,
  },
  content: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sans },
  linkTitle: {
    ...type.bodyMd,
    color: colors.body,
    fontFamily: fonts.sansMedium,
    marginTop: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.xl,
  },
  sectionLabel: {
    ...type.monoEyebrow,
    color: colors.faint,
    fontFamily: fonts.mono,
    marginBottom: spacing.sm,
  },
  tierRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.lg },
  tierBtn: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tierBtnActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  tierLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  tierLabelActive: { color: colors.onInk },
  projectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  projectChip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  projectChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  projectLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  projectLabelActive: { color: colors.onInk },
  graveBtn: { paddingVertical: spacing.sm },
  graveLabel: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sansMedium },
  deleteBtn: { paddingVertical: spacing.sm, marginTop: spacing.sm },
  deleteLabel: { ...type.bodyMd, color: colors.error, fontFamily: fonts.sansMedium },
});
