import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DatePickerModal } from '@/components/DatePickerModal';
import { parseDateKey, toDateKey } from '@/lib/dates';
import { createProject, fetchProjects, updateProject } from '@/lib/supabase';
import { colors, FLOOR_OPACITY, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Project, ProjectStatus } from '@/lib/types';

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '진행중',
  before: '시작전',
  paused: '중단',
  done: '완료',
};
const STATUS_DOT: Record<ProjectStatus, { color: string; filled: boolean }> = {
  active: { color: colors.ink, filled: true },
  before: { color: colors.mute, filled: false },
  paused: { color: colors.faint, filled: false },
  done: { color: colors.faint, filled: true },
};
const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, before: 1, paused: 2, done: 3 };
type StatusFilter = 'all' | ProjectStatus;
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '진행중' },
  { key: 'before', label: '시작전' },
  { key: 'paused', label: '중단' },
  { key: 'done', label: '완료' },
];
const CREATE_STATUSES: ProjectStatus[] = ['before', 'active', 'paused', 'done'];

// position 있으면 그걸로, 없으면 created_at(원래 순서)로 — 드래그 안 해본 그룹은 그대로
function compareByPosition(a: Project, b: Project): number {
  if (a.position != null && b.position != null) return a.position - b.position;
  if (a.position != null) return -1;
  if (b.position != null) return 1;
  return a.created_at.localeCompare(b.created_at);
}

// 프로젝트 목록 — 상태 칩으로 거른다. 상태 분류는 사이드바가 아니라 여기서 (PLAN.md §6.2)
export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStatus, setNewStatus] = useState<ProjectStatus>('before');
  const [newStartedAt, setNewStartedAt] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);
  useFocusEffect(load);

  // 드래그로 순서 바꾸면 해당 상태 그룹만 position(0,1,2..)으로 다시 채운다
  async function persistOrder(status: ProjectStatus, items: Project[]) {
    const withPosition = new Map(items.map((p, i) => [p.id, i]));
    setProjects((prev) =>
      prev.map((p) => (withPosition.has(p.id) ? { ...p, position: withPosition.get(p.id)! } : p)),
    );
    await Promise.all(items.map((p, i) => updateProject(p.id, { position: i })));
  }

  function resetCreateForm() {
    setNewName('');
    setNewStatus('before');
    setNewStartedAt(null);
    setCreating(false);
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    const project = await createProject(name, { status: newStatus, started_at: newStartedAt });
    resetCreateForm();
    load();
    router.push(`/projects/${project.id}`);
  }

  const visible = projects.filter((p) => filter === 'all' || p.status === filter);
  // 진행중 → 시작전 → 중단 → 완료 순으로 섹션을 나누고, 섹션 안에서만 드래그 정렬
  const sections = (Object.keys(STATUS_ORDER) as ProjectStatus[])
    .sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b])
    .map((status) => ({
      status,
      items: visible.filter((p) => p.status === status).sort(compareByPosition),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBtn}>‹ 뒤로</Text>
        </Pressable>
        <Text style={styles.title}>PROJECTS</Text>
        <Pressable onPress={() => setCreating(!creating)} hitSlop={12}>
          <Text style={styles.plus}>＋</Text>
        </Pressable>
      </View>

      {creating && (
        <View style={styles.createCard}>
          <TextInput
            style={styles.createInput}
            value={newName}
            onChangeText={setNewName}
            autoFocus
            placeholder="프로젝트 이름"
            placeholderTextColor={colors.faint}
            keyboardAppearance="dark"
            onSubmitEditing={create}
            returnKeyType="done"
          />

          <View style={styles.createStatusRow}>
            {CREATE_STATUSES.map((s) => {
              const active = newStatus === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setNewStatus(s)}
                  style={[styles.createStatusChip, active && styles.createStatusChipActive]}
                >
                  <Text
                    style={[
                      styles.createStatusLabel,
                      active && styles.createStatusLabelActive,
                    ]}
                  >
                    {STATUS_LABEL[s]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.createDateRow}>
            <Pressable onPress={() => setPickerOpen(true)} style={styles.dateTrigger}>
              <Text style={styles.dateTriggerLabel}>
                {newStartedAt ? newStartedAt.replaceAll('-', '.') : '시작일 선택 (선택)'}
              </Text>
            </Pressable>
            {newStartedAt && (
              <Pressable onPress={() => setNewStartedAt(null)} hitSlop={8}>
                <Text style={styles.dateClearLabel}>지우기</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setNewStartedAt(toDateKey(new Date()))} hitSlop={8}>
              <Text style={styles.dateTodayLabel}>오늘</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={create}
            disabled={!newName.trim()}
            style={[styles.createBtn, !newName.trim() && styles.createBtnDisabled]}
          >
            <Text style={styles.createBtnLabel}>만들기</Text>
          </Pressable>
        </View>
      )}

      {pickerOpen && (
        <DatePickerModal
          value={newStartedAt ? parseDateKey(newStartedAt) : null}
          onSelect={(key) => {
            setNewStartedAt(key);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {visible.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>프로젝트가 없다</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {sections.map((section, sectionIndex) => (
            <View key={section.status}>
              {section.status === 'done' && sectionIndex > 0 && (
                <View style={styles.doneDivider} />
              )}
              <DraggableFlatList
                data={section.items}
                scrollEnabled={false}
                keyExtractor={(p) => p.id}
                onDragBegin={() => setDragging(true)}
                onDragEnd={({ data }) => {
                  persistOrder(section.status, data);
                  setTimeout(() => setDragging(false), 150);
                }}
                renderItem={({ item, drag, isActive }: RenderItemParams<Project>) => {
                  const dot = STATUS_DOT[item.status];
                  return (
                    <Pressable
                      style={[
                        styles.row,
                        item.status === 'done' && styles.rowDone,
                        isActive && styles.rowActive,
                      ]}
                      onPress={() => {
                        if (dragging) return;
                        router.push(`/projects/${item.id}`);
                      }}
                      onLongPress={drag}
                    >
                      <View
                        style={[
                          styles.dot,
                          { borderColor: dot.color },
                          dot.filled && { backgroundColor: dot.color },
                        ]}
                      />
                      <View style={styles.rowBody}>
                        <Text style={styles.rowName}>{item.name}</Text>
                        <Text style={styles.rowMeta}>
                          {STATUS_LABEL[item.status]}
                          {item.started_at ? ` · ${item.started_at.replaceAll('-', '.')} 시작` : ''}
                          {` · 파편 ${item.fragment_count ?? 0}`}
                        </Text>
                      </View>
                      <Text style={styles.chevron}>›</Text>
                    </Pressable>
                  );
                }}
              />
            </View>
          ))}
        </ScrollView>
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
  title: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 2 },
  plus: { fontSize: 22, color: colors.ink },
  createCard: {
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.md,
  },
  createInput: {
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    padding: 0,
  },
  createStatusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  createStatusChip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  createStatusChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  createStatusLabel: { ...type.bodySm, color: colors.body, fontFamily: fonts.sansMedium },
  createStatusLabelActive: { color: colors.onInk },
  createDateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateTrigger: {
    flex: 1,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dateTriggerLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.mono },
  dateClearLabel: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sansMedium },
  dateTodayLabel: { ...type.bodySm, color: colors.body, fontFamily: fonts.sansMedium },
  createBtn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.ink,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  createBtnDisabled: { opacity: 0.35 },
  createBtnLabel: { ...type.bodyMd, color: colors.onInk, fontFamily: fonts.sansMedium },
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chipRow: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  chipLabelActive: { color: colors.onInk },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairlineSoft,
  },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  rowDone: { opacity: FLOOR_OPACITY },
  rowActive: { backgroundColor: colors.canvasElevated },
  rowBody: { flex: 1, gap: 2 },
  rowName: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium },
  rowMeta: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  doneDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.sm,
  },
  chevron: { ...type.bodyLg, color: colors.faint, fontFamily: fonts.sans },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
});
