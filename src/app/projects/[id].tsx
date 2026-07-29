import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DatePickerModal } from '@/components/DatePickerModal';
import { FragmentBullet } from '@/components/FragmentBullet';
import { confirmDelete } from '@/lib/confirm';
import { parseDateKey, toDateKey } from '@/lib/dates';
import { onFragmentUpdated } from '@/lib/fragmentUpdates';
import {
  deleteProject,
  fetchArchivedProjectFragments,
  fetchFragments,
  getProject,
  PAGE_SIZE,
  updateProject,
} from '@/lib/supabase';
import { colors, FLOOR_OPACITY, fonts, rounded, spacing, type } from '@/lib/theme';
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
  const [archivedFragments, setArchivedFragments] = useState<Fragment[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // 다른 리스트(피드 등)와 같은 방식 — 100개씩 끊어 읽고 바닥에 닿으면 이어 붙인다.
  const lastPage = useRef(0);
  const [exhausted, setExhausted] = useState(false);
  const loadingMore = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    getProject(id)
      .then((p) => {
        setProject(p);
        setName(p.name);
        setDescription(p.description ?? '');
      })
      .catch(() => {});
    fetchArchivedProjectFragments(id).then(setArchivedFragments).catch(() => {});
    try {
      const pages = await Promise.all(
        Array.from({ length: lastPage.current + 1 }, (_, i) => fetchFragments(id, i)),
      );
      setFragments(pages.flat());
      setExhausted(pages[pages.length - 1].length < PAGE_SIZE);
    } catch {
      // 실패해도 이미 읽은 목록은 그대로 둔다
    }
  }, [id]);

  const loadMore = useCallback(async () => {
    if (!id || exhausted || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const next = lastPage.current + 1;
      const frs = await fetchFragments(id, next);
      lastPage.current = next;
      setFragments((prev) => [...prev, ...frs]);
      if (frs.length < PAGE_SIZE) setExhausted(true);
    } catch {
      // 다음 스크롤에서 다시 시도
    } finally {
      loadingMore.current = false;
    }
  }, [id, exhausted]);

  useEffect(() => {
    lastPage.current = 0;
    setExhausted(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // 상세 수정이 이 화면이 뒤에 남아 있는 동안 끝날 수 있다 (포커스 안 바뀜)
  useEffect(() => onFragmentUpdated(load), [load]);

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

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 300) loadMore();
        }}
        scrollEventThrottle={200}
      >
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
          <Pressable onPress={() => setPickerOpen(true)} style={styles.dateTrigger}>
            <Text style={styles.dateTriggerLabel}>
              {project.started_at ? project.started_at.replaceAll('-', '.') : '시작일 선택'}
            </Text>
          </Pressable>
          {project.started_at && (
            <Pressable onPress={() => patch({ started_at: null })} hitSlop={8}>
              <Text style={styles.dateClearLabel}>지우기</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => patch({ started_at: toDateKey(new Date()) })}
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

        {/* 발견에서 제외 (2026-07-29) — "여행리스트 긁으면 안 됨".
            켜면 이 프로젝트와 **여기 묶인 파편까지** 브리핑 재료에서 빠진다(material.ts).
            발견에만 건다 — 채팅·검색에는 그대로 나온다. 선명도는 안 건드린다. */}
        <Text style={styles.sectionLabel}>발견</Text>
        <Pressable
          onPress={() => patch({ discover_skip: !project.discover_skip })}
          style={[styles.chip, styles.skipChip, project.discover_skip && styles.chipActive]}
        >
          <Text style={[styles.chipLabel, project.discover_skip && styles.chipLabelActive]}>
            발견에서 제외
          </Text>
        </Pressable>
        <Text style={styles.skipHint}>
          {project.discover_skip
            ? '여기 묶인 파편까지 브리핑 재료에서 빠진다 — 검색·채팅에는 그대로 나온다'
            : '켜면 이 프로젝트를 브리핑이 긁지 않는다'}
        </Text>

        <View style={styles.divider} />

        <View style={styles.fragmentsHeader}>
          <Text style={[styles.sectionLabel, styles.fragmentsLabel]}>
            FRAGMENTS · {fragments.length}
          </Text>
          <Pressable
            onPress={() => router.push({ pathname: '/input', params: { project: project.id } })}
            hitSlop={8}
          >
            <Text style={styles.addBtn}>+ 추가</Text>
          </Pressable>
        </View>
        {fragments.length === 0 ? (
          <Text style={styles.emptyText}>
            아직 붙은 파편이 없다 — 위 “+ 추가”로 던지거나, 파편 상세에서 이 프로젝트를 태그하면 여기 모인다
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

        {archivedFragments.length > 0 && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>묻힌 것 · {archivedFragments.length}</Text>
            {archivedFragments.map((fr) => (
              <Pressable key={fr.id} onPress={() => router.push(`/fragment/${fr.id}`)}>
                <FragmentBullet fragment={fr} rowOpacity={FLOOR_OPACITY} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      {pickerOpen && (
        <DatePickerModal
          value={project.started_at ? parseDateKey(project.started_at) : null}
          onSelect={(key) => {
            patch({ started_at: key });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
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
  // STATUS 칩은 chipRow가 감싸지만 이건 홀로 서므로 폭을 내용에 맞춘다
  skipChip: { alignSelf: 'flex-start' },
  skipHint: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans, marginTop: spacing.xs },
  chipLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  chipLabelActive: { color: colors.onInk },
  startRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  dateTrigger: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dateTriggerLabel: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.mono },
  dateClearLabel: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sansMedium },
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
  fragmentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  fragmentsLabel: { marginTop: 0, marginBottom: 0 },
  addBtn: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
});
