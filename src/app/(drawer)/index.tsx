import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DailyView } from '@/components/DailyView';
import { FragmentCard } from '@/components/FragmentCard';
import { MonthCalendar } from '@/components/MonthCalendar';
import { ProjectChips } from '@/components/ProjectChips';
import { SearchOverlay } from '@/components/SearchOverlay';
import { SwipeableRow } from '@/components/SwipeableRow';
import { TodayPill } from '@/components/TodayPill';
import { confirmDelete } from '@/lib/confirm';
import { agendaDateParts, dayKey, feedDateLabel, formatTime } from '@/lib/dates';
import {
  deleteFragment,
  fetchDayIndex,
  fetchFragments,
  fetchProjects,
  type FeedFilter,
  PAGE_SIZE,
} from '@/lib/supabase';
import { colors, FLOOR_OPACITY, fonts, rounded, spacing, type } from '@/lib/theme';
import { onThrown } from '@/lib/thrown';
import type { DayMark, Fragment, Project } from '@/lib/types';
import { vividness } from '@/lib/vividness';

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
  // 월 캘린더는 아직 스크롤로 안 읽은 날에도 점을 찍어야 한다 — 원문 없이 날짜만 따로 받는다
  const [dayIndex, setDayIndex] = useState<DayMark[]>([]);
  // 피드/어젠다는 최신이 맨 위 — 과거로 깊이 내려간 상태가 곧 "오늘에서 벗어남"이다
  const listRef = useRef<SectionList<Fragment>>(null);
  const [scrolledAway, setScrolledAway] = useState(false);
  // 스크롤이 지금 어느 날에 있나 → 상단 날짜 pill
  const [visibleDate, setVisibleDate] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingJump, setPendingJump] = useState<string | null>(null);

  // 지금까지 읽어들인 마지막 페이지. 100개씩 끊어 읽고, 바닥에 닿으면 이어 붙인다.
  const lastPage = useRef(0);
  const [exhausted, setExhausted] = useState(false); // 더 읽을 게 없다
  const loading = useRef(false);

  // 이미 읽은 페이지 전부를 다시 읽는다 — 상세에서 돌아왔을 때 앞부분만 갱신하면
  // 뒤에 이어 붙여둔 것들과 어긋난다.
  const load = useCallback(async () => {
    try {
      setFailed(false);
      const pages = await Promise.all(
        Array.from({ length: lastPage.current + 1 }, (_, i) => fetchFragments(filter, i)),
      );
      const [prs, index] = await Promise.all([fetchProjects(), fetchDayIndex(filter)]);
      setFragments(pages.flat());
      setProjects(prs);
      setDayIndex(index);
      setExhausted(pages[pages.length - 1].length < PAGE_SIZE);
    } catch {
      setFailed(true);
    }
  }, [filter]);

  // 바닥에 닿았다 → 다음 100개
  const loadMore = useCallback(async () => {
    if (exhausted || loading.current) return;
    loading.current = true;
    try {
      const next = lastPage.current + 1;
      const frs = await fetchFragments(filter, next);
      lastPage.current = next;
      setFragments((prev) => [...prev, ...frs]);
      if (frs.length < PAGE_SIZE) setExhausted(true);
    } catch {
      setFailed(true);
    } finally {
      loading.current = false;
    }
  }, [filter, exhausted]);

  // 필터가 바뀌면 처음부터 다시 읽는다
  useEffect(() => {
    lastPage.current = 0;
    setExhausted(false);
  }, [filter]);

  // 사이드바에서 렌즈를 고르면 그 렌즈가 실제로 보이는 화면으로 넘어간다.
  // 데일리는 렌즈를 무시하고 오늘 하루만 보므로(SPEC §6-0), 거기 머물면 아무 일도 안 일어난 것처럼 보인다.
  const prevFilter = useRef(filter);
  useEffect(() => {
    if (prevFilter.current === filter) return;
    prevFilter.current = filter;
    setMode((m) => (m === 'daily' ? 'feed' : m));
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

  // 월 캘린더의 점 — 리스트에 읽어들인 것과 무관하게 전체 날짜에 찍힌다
  const byDay = useMemo(() => {
    const map: Record<string, DayMark[]> = {};
    for (const m of dayIndex) (map[dayKey(m.created_at)] ??= []).push(m);
    return map;
  }, [dayIndex]);

  // onViewableItemsChanged는 렌더마다 새 함수를 주면 RN이 거부한다 — ref로 고정
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.section);
    const section = first?.section as { date: string } | undefined;
    if (section) setVisibleDate(section.date);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;

  // 고른 날이 아직 안 읽힌 과거일 수 있다 — 거기 닿을 때까지 읽어들인다
  async function jumpToDate(d: Date) {
    setPickerOpen(false);
    const key = dayKey(d.toISOString());
    let list = fragments;
    while (!list.some((fr) => dayKey(fr.created_at) === key)) {
      const oldest = list[list.length - 1];
      // 리스트 끝이 이미 그 날보다 과거인데도 없다 = 이 필터엔 그 날 파편이 없다
      if (!oldest || new Date(oldest.created_at) < d) return;
      const next = lastPage.current + 1;
      const more = await fetchFragments(filter, next);
      if (more.length === 0) return;
      lastPage.current = next;
      list = [...list, ...more];
      setFragments(list);
      if (more.length < PAGE_SIZE) setExhausted(true);
    }
    setPendingJump(key); // 섹션이 실제로 그려진 뒤에 스크롤한다
  }

  // setFragments 직후엔 아직 렌더 전이라 그 섹션이 없다 — 생기고 나서 움직인다
  useEffect(() => {
    if (!pendingJump) return;
    const sectionIndex = sections.findIndex((s) => s.key === pendingJump);
    if (sectionIndex < 0) return;
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex: 0, viewPosition: 0 });
    setPendingJump(null);
  }, [pendingJump, sections]);

  const fragmentOpacity = (fr: Fragment) =>
    filter === 'grave'
      ? FLOOR_OPACITY // 무덤 뷰는 25% 고정 (PLAN §3.2)
      : vividness(fr, now);

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
                {filter === 'grave'
                  ? '무덤이 비어 있다'
                  : filter === 'pinned'
                    ? '고정한 파편이 없다'
                    : '아직 파편이 없다'}
              </Text>
            </View>
          ) : (
            <View style={styles.listArea}>
            <SectionList
              ref={listRef}
              sections={sections}
              keyExtractor={(fr) => fr.id}
              stickySectionHeadersEnabled={false}
              contentContainerStyle={styles.listContent}
              scrollEventThrottle={16}
              onScroll={(e) => setScrolledAway(e.nativeEvent.contentOffset.y > 700)}
              onViewableItemsChanged={onViewable}
              viewabilityConfig={viewabilityConfig}
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
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
                  onEdit={() => router.push(`/fragment/${item.id}`)}
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

              {/* 스크롤 위치의 날짜 — 탭하면 월 캘린더가 내려온다 (헤더에 버튼을 늘리지 않는다) */}
              {visibleDate && !pickerOpen && (
                <Pressable
                  style={styles.datePill}
                  onPress={() => setPickerOpen(true)}
                  hitSlop={8}
                >
                  <Text style={styles.datePillLabel}>{feedDateLabel(visibleDate)}</Text>
                </Pressable>
              )}

              {pickerOpen && (
                <View style={styles.pickerWrap}>
                  <MonthCalendar
                    initial={visibleDate ? new Date(visibleDate) : now}
                    today={now}
                    byDay={byDay}
                    onSelect={jumpToDate}
                    onClose={() => setPickerOpen(false)}
                  />
                </View>
              )}

              <TodayPill
                visible={scrolledAway}
                onPress={() =>
                  listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: true })
                }
              />
            </View>
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
  listArea: { flex: 1 },
  // 리스트 위를 떠다닌다 — 고정 바로 만들면 안 그래도 빡빡한 화면을 또 잡아먹는다
  datePill: {
    position: 'absolute',
    top: spacing.xs,
    alignSelf: 'center',
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
  datePillLabel: { ...type.bodySm, color: colors.body, fontFamily: fonts.sansMedium },
  pickerWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
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
