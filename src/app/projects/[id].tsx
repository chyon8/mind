import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FragmentBullet } from '@/components/FragmentBullet';
import { confirmDelete } from '@/lib/confirm';
import {
  deleteProject,
  fetchFragments,
  getProject,
  updateProject,
} from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment, Project, ProjectStatus } from '@/lib/types';
import { vividness } from '@/lib/vividness';

const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: '진행중' },
  { value: 'before', label: '시작전' },
  { value: 'paused', label: '중단' },
  { value: 'done', label: '완료' },
];

// 프로젝트 상세 — 메타(상태/시작일/설명) + 매핑된 파편들 (PLAN.md §6.2)
// 마감일·진척률·태스크 없음. 프로젝트는 관리 도구가 아니라 렌즈다.
export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [name, setName] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [description, setDescription] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      getProject(id)
        .then((p) => {
          setProject(p);
          setName(p.name);
          setStartedAt(p.started_at ?? '');
          setDescription(p.description ?? '');
        })
        .catch(() => {});
      fetchFragments(id).then(setFragments).catch(() => {});
    }, [id]),
  );

  if (!project) return <SafeAreaView style={styles.screen} />;

  async function patch(p: Partial<Project>) {
    await updateProject(project!.id, p);
    setProject({ ...project!, ...p });
  }

  function saveName() {
    const n = name.trim();
    if (n && n !== project!.name) patch({ name: n });
    else setName(project!.name);
  }

  function saveStartedAt() {
    const s = startedAt.trim();
    if (s === '') return patch({ started_at: null });
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return patch({ started_at: s });
    setStartedAt(project!.started_at ?? ''); // 형식이 아니면 되돌림
  }

  function saveDescription() {
    const d = description.trim();
    patch({ description: d === '' ? null : d });
  }

  async function remove() {
    if (!(await confirmDelete('프로젝트를 삭제할까? 파편은 남고 매핑만 사라진다.'))) return;
    await deleteProject(project!.id);
    router.back();
  }

  const now = new Date();
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBtn}>‹ 뒤로</Text>
        </Pressable>
        <Pressable onPress={remove} hitSlop={12}>
          <Text style={styles.deleteBtn}>삭제</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.name}
          value={name}
          onChangeText={setName}
          onBlur={saveName}
          keyboardAppearance="dark"
        />

        <Text style={styles.sectionLabel}>STATUS</Text>
        <View style={styles.chipRow}>
          {STATUSES.map((s) => {
            const active = project.status === s.value;
            return (
              <Pressable
                key={s.value}
                onPress={() => patch({ status: s.value })}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>시작일</Text>
        <View style={styles.startRow}>
          <TextInput
            style={styles.startInput}
            value={startedAt}
            onChangeText={setStartedAt}
            onBlur={saveStartedAt}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.faint}
            keyboardAppearance="dark"
          />
          <Pressable
            onPress={() => {
              setStartedAt(todayStr);
              patch({ started_at: todayStr });
            }}
            style={styles.todayBtn}
          >
            <Text style={styles.todayLabel}>오늘</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>설명</Text>
        <TextInput
          style={styles.description}
          value={description}
          onChangeText={setDescription}
          onBlur={saveDescription}
          multiline
          placeholder="이게 뭔지, 왜 시작했는지…"
          placeholderTextColor={colors.faint}
          keyboardAppearance="dark"
        />

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>FRAGMENTS · {fragments.length}</Text>
        {fragments.length === 0 ? (
          <Text style={styles.emptyText}>
            아직 붙은 파편이 없다 — 파편 상세에서 이 프로젝트를 태그하면 여기 모인다
          </Text>
        ) : (
          fragments.map((fr) => (
            <Pressable key={fr.id} onPress={() => router.push(`/fragment/${fr.id}`)}>
              <FragmentBullet
                fragment={fr}
                rowOpacity={vividness(fr, now)}
              />
            </Pressable>
          ))
        )}
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
  deleteBtn: { ...type.bodyMd, color: colors.error, fontFamily: fonts.sansMedium },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxxl },
  name: {
    ...type.headingMd,
    color: colors.ink,
    fontFamily: fonts.sansSemiBold,
    marginBottom: spacing.lg,
    padding: 0,
  },
  sectionLabel: {
    ...type.monoEyebrow,
    color: colors.faint,
    fontFamily: fonts.mono,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  chipLabelActive: { color: colors.onInk },
  startRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  startInput: {
    ...type.bodyMd,
    color: colors.ink,
    fontFamily: fonts.mono,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    width: 140,
  },
  todayBtn: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  todayLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  description: {
    ...type.bodyMd,
    lineHeight: 22,
    color: colors.ink,
    fontFamily: fonts.sans,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    padding: spacing.sm,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.xl,
  },
  emptyText: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
});
