import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import type { FeedFilter } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Project } from '@/lib/types';

// 칩은 All + 전체 프로젝트(상태 무관). 만들거나 지우면 곧장 반영된다.
// 사이드바에서 고른 필터(Inbox/무덤 등)가 칩에 없으면 임시 칩으로 붙여 현재 위치를 보여준다.
// 프로젝트 칩을 길게 누르면 '전체'에서 그 프로젝트를 뺀다 (헤매기의 제외와 같은 방식, [13]).
export function ProjectChips({
  projects,
  selected,
  onSelect,
  excluded,
  onToggleExclude,
}: {
  projects: Project[];
  selected: FeedFilter;
  onSelect: (f: FeedFilter) => void;
  excluded?: Set<string>;
  onToggleExclude?: (projectId: string) => void;
}) {
  const chips: { key: FeedFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    ...projects.map((p) => ({ key: p.id as FeedFilter, label: p.name })),
  ];

  if (!chips.some((c) => c.key === selected)) {
    const label =
      selected === 'inbox'
        ? 'Inbox'
        : selected === 'grave'
          ? '무덤'
          : (projects.find((p) => p.id === selected)?.name ?? '');
    if (label) chips.push({ key: selected, label });
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {chips.map((chip) => {
        const active = selected === chip.key;
        const isProject = projects.some((p) => p.id === chip.key);
        const off = isProject && excluded?.has(chip.key);
        return (
          <Pressable
            key={chip.key}
            onPress={() => onSelect(chip.key)}
            onLongPress={isProject && onToggleExclude ? () => onToggleExclude(chip.key) : undefined}
            style={[styles.chip, active && styles.chipActive, off && styles.chipOff]}
          >
            <Text style={[styles.label, active && styles.labelActive, off && styles.labelOff]}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // 세로 리스트에 밀려 찌그러지지 않도록 콘텐츠 높이 고정
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  // 길게 눌러 제외한 프로젝트 — 취소선으로 "빠져 있다"를 바로 읽히게 (wander.tsx와 같은 문법)
  chipOff: { borderColor: colors.hairlineSoft, backgroundColor: 'transparent' },
  label: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  labelActive: { color: colors.onInk },
  labelOff: { color: colors.faint, textDecorationLine: 'line-through' },
});
