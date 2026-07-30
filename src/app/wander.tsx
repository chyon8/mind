import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FragmentCard } from '@/components/FragmentCard';
import { fetchDayIndex, fetchFragmentsByIds, fetchProjects, type FeedFilter } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import { onFragmentUpdated } from '@/lib/fragmentUpdates';
import type { Fragment, Project } from '@/lib/types';
import { vividness } from '@/lib/vividness';

// filter 아래 이 파편이 지금도 이 헤맴에 속하는지 — fetchFragments의 필터 조건과 같다.
// excluded는 '전체'에서만 적용한다 (칩을 길게 눌러 뺀 프로젝트).
function matchesFilter(fr: Fragment, filter: FeedFilter, excluded: Set<string>): boolean {
  if (fr.archived) return false;
  if (filter === 'all') return !fr.project_ids.some((id) => excluded.has(id));
  if (filter === 'inbox') return fr.project_ids.length === 0;
  return fr.project_ids.includes(filter);
}

// 헤매기 — 무작위로 흘러나온다. 딴생각하며 머릿속을 거니는 것에 가깝다.
//
// **판단 버튼이 없다.** 여기에 기억하기/흘려보내기를 붙이면 결국 보관함 전체를 솎아내는
// 노동이 된다 — SPEC §7이 금지한 정리 스와이프다. 지나가는 것만으론 아무 일도 안 일어나고,
// 마음이 가서 탭해 열면 그때 선명해진다 (스스로 찾아간 것이므로 정당한 touch다).
// 판단하는 자리는 데일리의 "떠오른 것" 하나뿐이다. **한 바퀴로 끝나게 바뀐 뒤에도 이건 그대로다**
// — 끝이 생겼다고 여기에 판단 버튼을 붙이지 마라.
//
// 2026-07-28 유저 지시로 **한 바퀴에서 끝난다.** 예전엔 덱이 비면 다시 섞어 무한히 돌았다.
//
// 나란히 놓인 두 파편 사이의 연결은 저장하지 않는다. 연결은 당신 머릿속에서 일어난다.
const CHUNK = 8;

// 헤맬 때 빼둘 프로젝트 (칩 길게 누르기). 자주 바꾸는 게 아니라 한 번 정해두는 성격이라 로컬에 남긴다.
const EXCLUDE_KEY = 'wander.excluded';

// 바닥(25%)까지 흐려진 걸 그대로 그리면 읽을 수가 없다. 여기선 보여주려고 꺼낸 것이므로
// 바닥을 올려 읽히게 하되, 서로의 차이는 남긴다 — 지층감은 타임라인의 몫이다.
const READABLE_FLOOR = 0.55;

function shuffle(ids: string[]): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function Wander() {
  const pool = useRef<string[]>([]); // 전체 id
  const deck = useRef<string[]>([]); // 이번 바퀴에 남은 것
  const [items, setItems] = useState<Fragment[]>([]);
  const [empty, setEmpty] = useState(false);
  const [done, setDone] = useState(false); // 한 바퀴 다 돌았다
  const [projects, setProjects] = useState<Project[]>([]);
  // 어디서 헤맬지 태그로 좁힌다 — 기본은 전체 (PLAN §6.3, [13])
  const [filter, setFilter] = useState<FeedFilter>('all');
  // '전체'에서 빼둘 프로젝트 id. 칩을 길게 누르면 토글된다.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // excluded를 로컬에서 읽어오기 전에 첫 바퀴를 시작하면 안 뺀 것들이 섞여 나온다 (아래 이펙트)
  const [hydrated, setHydrated] = useState(false);
  const loading = useRef(false);
  // 이번 조건의 덱이 만들어졌나. 만들어지기 전에 onEndReached가 more()를 부르면
  // 빈 덱을 보고 "여기까지"를 세워버린다 — 첫 배치가 도착하자마자 끝났다고 표시된다.
  const ready = useRef(false);
  // 조건 전환 세대. 늦게 도착한 이전 조건의 응답이 덱을 덮어쓰지 못하게 한다.
  const run = useRef(0);

  // 프로젝트에 정리된 파편도 그대로 흐르되, 어디 소속인지 태그로 구분한다 ([13])
  const projectsById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const filterOptions = useMemo(
    () => [
      { id: 'all' as FeedFilter, name: '전체' },
      { id: 'inbox' as FeedFilter, name: 'Inbox' },
      ...projects.map((p) => ({ id: p.id as FeedFilter, name: p.name })),
    ],
    [projects],
  );

  // 한 바퀴로 끝난다 (2026-07-28). 덱을 다 쓰면 다시 섞지 않고 done을 세운다.
  const more = useCallback(async () => {
    if (loading.current || !ready.current) return;
    if (deck.current.length === 0) {
      setDone(true);
      return;
    }
    loading.current = true;
    try {
      const ids = deck.current.splice(0, Math.min(CHUNK, deck.current.length));
      const frs = await fetchFragmentsByIds([...new Set(ids)]);
      // 조회는 순서를 보장하지 않는다 — 섞어둔 순서대로 되돌린다
      const byId = new Map(frs.map((fr) => [fr.id, fr]));
      setItems((prev) => [...prev, ...ids.map((id) => byId.get(id)).filter((fr) => fr != null)]);
    } catch {
      // 한 번 실패해도 다음 스크롤에서 다시 시도한다
    } finally {
      loading.current = false;
    }
  }, []);

  // items는 자주 바뀌므로(스크롤할 때마다) ref로 최신 값을 들고 있는다 —
  // refreshItems를 items 변화마다 새로 만들면 구독이 계속 갈아끼워진다.
  const itemsRef = useRef<Fragment[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // 상세에서 돌아왔을 때 이미 뽑아둔 카드만 최신 상태로 맞춘다 — 순서·스크롤 위치는 안 흔든다.
  // 헤매기는 끝내야 할 목록이 아니므로 전체 재섞기는 하지 않는다.
  const refreshItems = useCallback(async () => {
    const current = itemsRef.current;
    if (current.length === 0) return;
    const ids = current.map((fr) => fr.id);
    let fresh: Fragment[];
    try {
      fresh = await fetchFragmentsByIds(ids);
    } catch {
      return;
    }
    const byId = new Map(fresh.map((fr) => [fr.id, fr]));
    const stale = new Set(
      ids.filter((id) => {
        const fr = byId.get(id);
        return !fr || !matchesFilter(fr, filter, excluded);
      }),
    );
    if (stale.size > 0) {
      pool.current = pool.current.filter((id) => !stale.has(id));
      deck.current = deck.current.filter((id) => !stale.has(id));
    }
    setItems((prev) => prev.filter((fr) => !stale.has(fr.id)).map((fr) => byId.get(fr.id) ?? fr));
  }, [filter, excluded]);

  useFocusEffect(
    useCallback(() => {
      refreshItems();
    }, [refreshItems]),
  );

  // 상세 수정이 이 화면이 뒤에 남아 있는 동안 끝날 수 있다 (포커스 안 바뀜)
  useEffect(() => onFragmentUpdated(refreshItems), [refreshItems]);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
    AsyncStorage.getItem(EXCLUDE_KEY)
      .then((raw) => raw && setExcluded(new Set(JSON.parse(raw) as string[])))
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // 칩 길게 누르기 — '전체'에서 이 프로젝트를 뺀다. 아래 이펙트가 바퀴를 다시 돌린다.
  const toggleExclude = useCallback((projectId: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(projectId)) next.add(projectId);
      AsyncStorage.setItem(EXCLUDE_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  // 태그나 제외가 바뀌면 처음부터 다시 헤맨다 — 이전 조건의 카드가 섞여 나오면 안 된다.
  //
  // ⚠️ hydrated를 기다리는 이유(2026-07-30 수정): AsyncStorage에서 excluded를 읽는 건 비동기라
  // 예전엔 이 이펙트가 excluded=∅으로 한 번 먼저 돌았다. 저장된 제외 목록이 도착해 두 번째로
  // 돌아도, 먼저 떠난 fetchDayIndex가 나중에 응답하면 걸러지지 않은 덱이 그대로 덮어썼다
  // — "헤매기에 들어가면 필터가 안 먹은 상태로 시작하고, 다른 탭을 눌렀다 와야 먹는다"의 원인.
  // 세대(run)로 늦은 응답을 버리고, 첫 바퀴 자체를 excluded가 도착한 뒤로 미룬다.
  useEffect(() => {
    if (!hydrated) return;
    const version = ++run.current;
    pool.current = [];
    deck.current = [];
    loading.current = false;
    ready.current = false;
    setItems([]);
    setEmpty(false);
    setDone(false);
    fetchDayIndex(filter)
      .then((index) => {
        if (version !== run.current) return; // 이전 조건의 응답 — 버린다
        // 제외는 '전체'에서만 — 프로젝트 필터는 !inner 조인이라 project_ids가 불완전하다.
        const kept =
          filter === 'all' && excluded.size > 0
            ? index.filter((m) => !(m.project_ids ?? []).some((id) => excluded.has(id)))
            : index;
        pool.current = kept.map((m) => m.id);
        // 한 바퀴 = 이 덱 하나. 다 쓰면 more()가 done을 세운다.
        deck.current = shuffle(pool.current);
        ready.current = true;
        if (pool.current.length === 0) setEmpty(true);
        else more();
      })
      .catch(() => {
        if (version === run.current) setEmpty(true);
      });
    // more는 스크롤이 부른다 — 여기선 조건 전환 시 첫 배치만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, excluded, hydrated]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </Pressable>
        <Text style={styles.title}>헤매기</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {filterOptions.map((f) => {
          const active = f.id === filter;
          // 전체·Inbox는 뺄 프로젝트가 아니다 — 프로젝트 칩만 길게 눌러 제외한다.
          const isProject = f.id !== 'all' && f.id !== 'inbox';
          const off = isProject && excluded.has(f.id);
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              onLongPress={isProject ? () => toggleExclude(f.id) : undefined}
              style={[styles.filterChip, active && styles.filterChipActive, off && styles.filterChipOff]}
            >
              <Text
                style={[
                  styles.filterLabel,
                  active && styles.filterLabelActive,
                  off && styles.filterLabelOff,
                ]}
              >
                {f.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={items}
        keyExtractor={(fr, i) => `${fr.id}-${i}`}
        contentContainerStyle={styles.list}
        onEndReached={more}
        onEndReachedThreshold={0.6}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/fragment/${item.id}`)}>
            <FragmentCard
              fragment={item}
              opacity={Math.max(vividness(item), READABLE_FLOOR)}
              projectsById={projectsById}
            />
          </Pressable>
        )}
        ListEmptyComponent={
          empty ? <Text style={styles.empty}>헤맬 것이 아직 없다</Text> : null
        }
        ListFooterComponent={
          done && items.length > 0 ? <Text style={styles.end}>여기까지</Text> : null
        }
      />
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
  back: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  title: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 1 },
  spacer: { width: 44 },
  // 세로 리스트에 밀려 찌그러지지 않도록 (ProjectChips와 같은 이유)
  filterScroll: { flexGrow: 0, flexShrink: 0, marginBottom: spacing.xxs },
  // ⚠️ paddingVertical이 반드시 있어야 한다. 없으면 ScrollView 높이가 칩 높이와 같아져서
  //    borderRadius 알약의 위아래가 잘린다 — 눌러서 배경이 채워지면 잘린 게 그대로 보인다.
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterChip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  filterChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  // 길게 눌러 제외한 프로젝트 — 취소선으로 "빠져 있다"를 바로 읽히게
  filterChipOff: { borderColor: colors.hairlineSoft, backgroundColor: 'transparent' },
  filterLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  filterLabelActive: { color: colors.onInk },
  filterLabelOff: { color: colors.faint, textDecorationLine: 'line-through' },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },
  empty: {
    ...type.bodyMd,
    color: colors.mute,
    fontFamily: fonts.sans,
    textAlign: 'center',
    paddingTop: spacing.xxl,
  },
  end: {
    ...type.bodySm,
    color: colors.faint,
    fontFamily: fonts.sans,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
