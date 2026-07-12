import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import type { FeedFilter } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Project } from '@/lib/types';

// 칩은 All + 진행중(active) 프로젝트만. Inbox/무덤/나머지 프로젝트는 사이드바에서.
// 사이드바에서 고른 필터가 칩에 없으면 임시 칩으로 붙여 현재 위치를 보여준다.
export function ProjectChips({
  projects,
  selected,
  onSelect,
}: {
  projects: Project[];
  selected: FeedFilter;
  onSelect: (f: FeedFilter) => void;
}) {
  const chips: { key: FeedFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    ...projects
      .filter((p) => p.status === 'active')
      .map((p) => ({ key: p.id as FeedFilter, label: p.name })),
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
        return (
          <Pressable
            key={chip.key}
            onPress={() => onSelect(chip.key)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{chip.label}</Text>
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
  label: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  labelActive: { color: colors.onInk },
});
