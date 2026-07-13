import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DailyView } from '@/components/DailyView';
import { FragmentCard } from '@/components/FragmentCard';
import { ProjectChips } from '@/components/ProjectChips';
import { SearchOverlay } from '@/components/SearchOverlay';
import { SwipeableRow } from '@/components/SwipeableRow';
import { confirmDelete } from '@/lib/confirm';
import { agendaDateParts, dayKey, feedDateLabel, formatTime } from '@/lib/dates';
import { deleteFragment, fetchFragments, fetchProjects, type FeedFilter } from '@/lib/supabase';
import { colors, FLOOR_OPACITY, fonts, rounded, spacing, type } from '@/lib/theme';
import { onThrown } from '@/lib/thrown';
import type { Fragment, Project } from '@/lib/types';
import { opacity } from '@/lib/vividness';

type Mode = 'daily' | 'feed' | 'agenda';
const MODE_LABEL: Record<Mode, string> = { daily: '데일리', feed: '피드', agenda: '어젠다' };

export default function Home() {
  // 드로어 화면의 navigation에는 openDrawer 헬퍼가 있다 (expo-router 내장 드로어)
  const navigation = useNavigation<{ openDrawer: () => void }>();
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter: FeedFilter = params.filter ?? 'all';

  const [mode, setMode] = useState<Mode>('daily');
  const [searchOpen, setSearchOpen] = useState(false);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      const [frs, prs] = await Promise.all([fetchFragments(filter), fetchProjects()]);
      setFragments(frs);
      setProjects(prs);
    } catch {
      setFailed(true);
    }
  }, [filter]);

  // 입력/상세에서 돌아올 때 포함, 화면이 보일 때마다 갱신
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // 공유 저장은 이 화면이 이미 떠 있는 채로 일어난다 — 포커스가 안 바뀌므로 직접 듣는다
  useEffect(() => onThrown(load), [load]);

  const now = useMemo(() => new Date(), [fragments]);

  const sections = useMemo(() => {
    const groups: { key: string; date: string; data: Fragment[] }[] = [];
    for (const fr of fragments) {
      const key = dayKey(fr.created_at);
      const last = groups[groups.length - 1];
      if (last?.key === key) last.data.push(fr);
      else groups.push({ key, date: fr.created_at, data: [fr] });
    }
    return groups;
  }, [fragments]);

  const fragmentOpacity = (fr: Fragment) =>
    filter === 'grave'
      ? FLOOR_OPACITY // 무덤 뷰는 25% 고정 (PLAN §3.2)
      : opacity(new Date(fr.last_touched_at), fr.tier, now);

  async function removeFragment(fr: Fragment) {
    if (!(await confirmDelete())) return;
    try {
      await deleteFragment(fr);
      load();
    } catch {
      setFailed(true);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => navigation.openDrawer()} hitSlop={12}>
            <Text style={styles.menuIcon}>☰</Text>
          </Pressable>
          <Text style={styles.wordmark}>MIND</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable onPress={() => setSearchOpen(true)} hitSlop={12}>
            <Text style={styles.searchIcon}>⌕</Text>
          </Pressable>
          <View style={styles.toggle}>
            {(['daily', 'feed', 'agenda'] as Mode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.toggleBtn, mode === m && styles.toggleBtnActive]}
              >
                <Text style={[styles.toggleLabel, mode === m && styles.toggleLabelActive]}>
                  {MODE_LABEL[m]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {mode === 'daily' ? (
        // 데일리는 필터와 무관하게 전체(무덤 제외)를 본다 — 렌즈는 피드/프로젝트 상세의 역할
        <DailyView />
      ) : (
        <>
          <ProjectChips
            projects={projects}
            selected={filter}
            onSelect={(f) => router.setParams({ filter: f })}
          />

          {failed ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>불러오지 못했다</Text>
              <Pressable onPress={load} style={styles.retry}>
                <Text style={styles.retryLabel}>다시 시도</Text>
              </Pressable>
            </View>
          ) : sections.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                {filter === 'grave' ? '무덤이 비어 있다' : '아직 파편이 없다'}
              </Text>
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(fr) => fr.id}
              stickySectionHeadersEnabled={false}
              contentContainerStyle={styles.listContent}
              renderSectionHeader={({ section }) =>
                mode === 'feed' ? (
                  <View style={styles.feedSep}>
                    <Text style={styles.feedSepLabel}>{feedDateLabel(section.date)}</Text>
                    <View style={styles.feedSepLine} />
                  </View>
                ) : (
                  <AgendaHeader iso={section.date} />
                )
              }
              renderItem={({ item }) => (
                <SwipeableRow
                  onEdit={() => router.push({ pathname: '/input', params: { id: item.id } })}
                  onDelete={() => removeFragment(item)}
                >
                  <Pressable onPress={() => router.push(`/fragment/${item.id}`)}>
                    {mode === 'feed' ? (
                      <View style={styles.cardWrap}>
                        <FragmentCard fragment={item} opacity={fragmentOpacity(item)} />
                      </View>
                    ) : (
                      <AgendaRow fragment={item} rowOpacity={fragmentOpacity(item)} />
                    )}
                  </Pressable>
                </SwipeableRow>
              )}
            />
          )}
        </>
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/input')}>
        <Text style={styles.fabLabel}>＋ 던지기</Text>
      </Pressable>

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </SafeAreaView>
  );
}

// 어젠다: 날짜가 주인공 — 큰 숫자 + 요일, 아래 파편이 밀도 높은 한 줄 행 (SPEC §6-2)
function AgendaHeader({ iso }: { iso: string }) {
  const { day, sub } = agendaDateParts(iso);
  return (
    <View style={styles.agendaHeader}>
      <Text style={styles.agendaDay}>{day}</Text>
      <Text style={styles.agendaSub}>{sub}</Text>
    </View>
  );
}

function AgendaRow({ fragment, rowOpacity }: { fragment: Fragment; rowOpacity: number }) {
  const line =
    fragment.type === 'link'
      ? (fragment.link_title ?? fragment.content)
      : fragment.type === 'image'
        ? (fragment.content || '(이미지)')
        : fragment.content.replace(/\n/g, ' ');
  return (
    <View style={[styles.agendaRow, { opacity: rowOpacity }]}>
      <Text style={styles.agendaTime}>{formatTime(fragment.created_at)}</Text>
      <Text style={styles.agendaText} numberOfLines={1}>
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  menuIcon: { fontSize: 18, color: colors.body },
  searchIcon: { fontSize: 22, color: colors.body },
  wordmark: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 2 },
  toggle: { flexDirection: 'row', gap: spacing.xxs },
  toggleBtn: {
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  toggleBtnActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  toggleLabel: { ...type.bodySm, color: colors.body, fontFamily: fonts.sansMedium },
  toggleLabelActive: { color: colors.onInk },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: 120 },
  cardWrap: { marginBottom: spacing.sm },
  feedSep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  feedSepLabel: { ...type.monoEyebrow, color: colors.body, fontFamily: fonts.mono },
  feedSepLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
  agendaHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  agendaDay: { ...type.displayLg, color: colors.ink, fontFamily: fonts.sansSemiBold },
  agendaSub: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono },
  agendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairlineSoft,
    backgroundColor: colors.canvas,
  },
  agendaTime: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono, width: 42 },
  agendaText: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sans, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
  retry: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  retryLabel: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium },
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    alignSelf: 'center',
    backgroundColor: colors.ink,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  fabLabel: { ...type.bodyLg, color: colors.onInk, fontFamily: fonts.sansMedium },
});
