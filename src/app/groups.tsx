// "무리" — 살아있는 파편을 묶어서 본다 (2026-08-12).
//
// 갈래가 둘이다 (2026-08-22 유저 결정): 기본은 임베딩 유사도(즉시·$0·매번 같은 결과),
// "스마트"를 누르면 LLM이 의도로 묶는다(12초·유료·매번 다른 결과). 왜 둘 다 두는지는
// supabase/functions/groups/index.ts 머리주석에 있다.
//
// ⚠️ **스마트 결과만 기기에 남긴다** (AsyncStorage, 2026-08-22 유저 요청: "다음에 왔을때
//    저번에 해둔게 남아있고 내가 다시를 누르면 재생성"). 12초 걸리고 돈이 드는 걸 화면 열
//    때마다 다시 돌리는 건 말이 안 된다. 만료 없음 — 언제 새로 묶을지는 유저가 정한다.
//    §2-1(규정 금지)에 안 걸린다: 금지된 건 **DB에 "이 사람은 이렇다"를 적는 것**이고,
//    여긴 기기 캐시다. 회상이 뽑은 결과를 같은 방식으로 남기는 게 선례(recall.ts).
//    기본 갈래는 안 남긴다 — 즉시 나오니 캐시할 이유가 없다.
//
// 판단 버튼 없음 — 헤매기와 같은 규칙(SPEC §7). 탭해서 상세로 들어가면 그때 touch된다.
// 무리 소속은 저장하지 않는다 — 매번 새로 계산해서 보여줄 뿐이다 (§2-1).
//
// 머리글은 기본 갈래에선 대표 파편(medoid) 한 줄, 스마트 갈래에선 무리 이름이다.
// **누르면 펼치기만 한다.** 파편을 열려면 펼친 목록에서 그 줄을 직접 누른다 (머리글 안에
// Pressable을 겹쳐 넣었다가 탭이 어디로 갈지 모르게 됐었다, 2026-08-12).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FragmentBullet } from '@/components/FragmentBullet';
import { fetchFragmentsByIds, fetchGroups, type FragmentGroup } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { vividness } from '@/lib/vividness';

const NOISE = 'noise'; // 접힘 상태 맵에서 "안 묶인 것" 섹션의 자리

// 기본 갈래의 머리글 한 줄 — FragmentBullet이 뽑는 줄과 같은 규칙(링크는 제목, 이미지는 캡션).
// 스마트 갈래는 이걸 안 쓴다 — 거긴 모델이 붙인 이름이 온다.
function headLine(fr: Fragment): string {
  if (fr.type === 'link') return fr.link_title ?? fr.content;
  if (fr.type === 'image') return fr.content || '(이미지)';
  return fr.content.replace(/\n/g, ' ');
}

// 헤매기에서 칩을 길게 눌러 빼둔 프로젝트 (wander.tsx가 쓰는 그 키를 읽기만 한다).
const EXCLUDE_KEY = 'wander.excluded';
// 그 제외를 무리에도 적용할지 — 무리와 헤매기는 보는 자리가 달라 따로 켜고 끈다.
const APPLY_KEY = 'groups.applyExclude';
// 마지막 스마트 묶기 결과.
const SMART_KEY = 'groups.smart';

// exclude를 같이 남긴다 — 제외 설정을 바꾸면 이 결과는 다른 입력으로 만든 것이 된다.
// 그때 조용히 옛 결과를 보여주는 대신 "설정이 바뀌었다"고 말한다.
type SmartCache = {
  at: number;
  exclude: string[];
  groups: FragmentGroup[];
  noiseIds: string[];
};

// "8월 22일 15:14" — 언제 묶은 건지 화면에 밝힌다. 안 밝히면 오늘 것인지 지난주 것인지 모른다.
function whenLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `오늘 ${hm}` : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
}

export default function Groups() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [groups, setGroups] = useState<FragmentGroup[]>([]);
  const [noiseIds, setNoiseIds] = useState<string[]>([]);
  const [byId, setById] = useState<Map<string, Fragment>>(new Map());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<string[]>([]);
  const [applyExclude, setApplyExclude] = useState(false);
  const [smart, setSmart] = useState(false);
  // 지금 보고 있는 스마트 결과를 언제·어떤 제외로 만들었나 (캐시에서 왔으면 채워진다).
  const [cache, setCache] = useState<{ at: number; exclude: string[] } | null>(null);
  // 저장된 값이 도착하기 전에 첫 묶기를 시작하면 조건이 안 먹은 결과가 나온다 (wander.tsx와 같은 함정)
  const [hydrated, setHydrated] = useState(false);
  // 늦게 오는 응답을 버린다 (wander.tsx의 run과 같은 수법). 스마트가 12초라 실제로 겹친다 —
  // 스마트를 켜고 12초 안에 다시 끄면, 나중에 도착한 스마트 결과가 기본 화면을 덮어썼다.
  const run = useRef(0);

  // force=true면 캐시를 무시하고 새로 묶는다 ("다시" 버튼). 기본 갈래는 캐시가 없어 항상 새로.
  const load = useCallback(
    async (useSmart: boolean, force: boolean) => {
      const version = ++run.current;
      setLoading(true);
      setError(false);
      try {
        const exclude = applyExclude ? excluded : [];
        let g: FragmentGroup[] | null = null;
        let n: string[] = [];
        let meta: { at: number; exclude: string[] } | null = null;

        if (useSmart && !force) {
          const raw = await AsyncStorage.getItem(SMART_KEY);
          try {
            if (raw) {
              const c = JSON.parse(raw) as SmartCache;
              g = c.groups;
              n = c.noiseIds;
              meta = { at: c.at, exclude: c.exclude };
            }
          } catch {
            // 깨진 캐시로 화면이 영영 안 뜨면 안 된다 — 무시하고 새로 묶는다
          }
        }

        if (!g) {
          const fresh = await fetchGroups(exclude, useSmart);
          g = fresh.groups;
          n = fresh.noiseIds;
          if (useSmart) {
            meta = { at: Date.now(), exclude };
            const save: SmartCache = { ...meta, groups: g, noiseIds: n };
            await AsyncStorage.setItem(SMART_KEY, JSON.stringify(save)).catch(() => {});
          }
        }

        // 캐시가 만들어진 뒤 묻힌 파편은 빼고 그린다 — 무덤은 무리에 안 들어간다.
        // 없어진 id는 조용히 사라지고, 통째로 빈 무리는 렌더에서 빠진다.
        const frs = await fetchFragmentsByIds([
          ...new Set([...g.flatMap((x) => x.memberIds), ...n]),
        ]);
        if (version !== run.current) return;
        setGroups(g);
        setNoiseIds(n);
        setById(new Map(frs.filter((fr) => !fr.archived).map((fr) => [fr.id, fr])));
        setCache(useSmart ? meta : null);
        setOpen(new Set());
      } catch {
        if (version === run.current) setError(true);
      } finally {
        if (version === run.current) setLoading(false);
      }
    },
    [applyExclude, excluded],
  );

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(EXCLUDE_KEY),
      AsyncStorage.getItem(APPLY_KEY),
      AsyncStorage.getItem(SMART_KEY),
    ])
      .then(([ex, apply, cached]) => {
        if (ex) setExcluded(JSON.parse(ex) as string[]);
        if (apply === '1') setApplyExclude(true);
        // 지난번에 스마트로 묶어뒀으면 그걸 보여주면서 연다 — 그게 이 사람이 마지막으로 본 화면이다.
        if (cached) setSmart(true);
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // 갈래·제외를 바꾸면 다시 그린다. 스마트는 캐시가 있으면 캐시로 — 토글이 돈을 쓰면 안 된다.
  useEffect(() => {
    if (hydrated) load(smart, false);
  }, [hydrated, smart, load]);

  const toggleApply = useCallback(() => {
    setApplyExclude((prev) => {
      AsyncStorage.setItem(APPLY_KEY, prev ? '0' : '1').catch(() => {});
      return !prev;
    });
  }, []);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const liveNoise = noiseIds.filter((id) => byId.has(id));

  const now = new Date();
  const row = (id: string) => {
    const fr = byId.get(id);
    if (!fr) return null;
    return (
      <Pressable key={id} onPress={() => router.push(`/fragment/${id}`)}>
        <FragmentBullet fragment={fr} rowOpacity={vividness(fr, now)} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </Pressable>
        {/* 제목 자리에 갈래를 놓는다 — 묶는 방식은 필터가 아니라 지금 뭘 보고 있나이므로
            칩 줄에 있으면 아래 제외 칩과 같은 급으로 읽힌다. 이름이 화면을 설명한다. */}
        <View style={styles.seg}>
          <Pressable
            onPress={() => setSmart(false)}
            disabled={loading}
            style={[styles.segCell, !smart && styles.segCellOn]}
          >
            <Text style={[styles.segLabel, !smart && styles.segLabelOn]}>기본</Text>
          </Pressable>
          <Pressable
            onPress={() => setSmart(true)}
            disabled={loading}
            style={[styles.segCell, smart && styles.segCellOn]}
          >
            <Text style={[styles.segLabel, smart && styles.segLabelOn]}>스마트</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => load(smart, true)} hitSlop={12} disabled={loading}>
          <Text style={[styles.refresh, loading && styles.refreshDisabled]}>다시</Text>
        </Pressable>
      </View>

      {/* 뺀 프로젝트가 없으면 이 줄은 아무 의미가 없다 — 안 그린다. */}
      {excluded.length > 0 && (
        <View style={styles.optionRow}>
          <Pressable
            onPress={toggleApply}
            disabled={loading}
            style={[styles.option, applyExclude && styles.optionOn]}
          >
            <Text style={[styles.optionLabel, applyExclude && styles.optionLabelOn]}>
              헤매기에서 뺀 것 빼고
            </Text>
          </Pressable>
        </View>
      )}

      {/* 스마트는 지난 결과를 다시 보여주는 것이라, 언제 묶은 건지 안 밝히면 오늘 것인 줄 안다. */}
      {smart && cache && !loading && (
        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {whenLabel(cache.at)}에 묶음 · 다시 누르면 12초 걸려 새로 묶는다
          </Text>
          {/* 제외 설정이 바뀌면 이 결과는 다른 입력으로 만든 것이다. 조용히 보여주지 않는다. */}
          {cache.exclude.join(',') !== (applyExclude ? excluded : []).join(',') && (
            <Text style={styles.metaWarn}>제외 설정이 바뀐 뒤로 아직 안 묶었다</Text>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.mute} />
          {/* 스마트는 실측 12초다. 말 없이 돌면 멈춘 줄 안다. */}
          {smart && <Text style={styles.centerText}>의도로 묶는 중…</Text>}
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>안 됐다. 다시 눌러봐.</Text>
        </View>
      ) : groups.length === 0 && liveNoise.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>아직 묶을 게 없다</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {groups.map((g) => {
            // 두 갈래 다 한 파편이 한 무리에만 속하므로 첫 멤버 id가 고유한 키다.
            // 이름은 모델이 붙인 거라 겹칠 수 있어서 키로 못 쓴다.
            const key = g.memberIds[0];
            const isOpen = open.has(key);
            // 캐시된 결과라면 그 사이에 묻힌 파편이 섞여 있다 — 살아있는 것만 센다.
            const members = g.memberIds.filter((id) => byId.has(id));
            const rep = g.repId ? byId.get(g.repId) : null;
            const head = g.label ?? (rep ? headLine(rep) : null);
            if (!head || members.length === 0) return null;
            return (
              <View key={key} style={styles.group}>
                <Pressable onPress={() => toggle(key)} style={styles.groupHead}>
                  <Text style={styles.headLabel} numberOfLines={1}>
                    {head}
                  </Text>
                  <Text style={styles.count}>{members.length}개</Text>
                  <Text style={styles.chevron}>{isOpen ? '▴' : '▾'}</Text>
                </Pressable>
                {isOpen && <View style={styles.members}>{members.map(row)}</View>}
              </View>
            );
          })}

          {liveNoise.length > 0 && (
            <View style={styles.group}>
              <Pressable onPress={() => toggle(NOISE)} style={styles.groupHead}>
                <Text style={[styles.headLabel, styles.noiseLabel]}>안 묶인 것</Text>
                <Text style={styles.count}>{liveNoise.length}개</Text>
                <Text style={styles.chevron}>{open.has(NOISE) ? '▴' : '▾'}</Text>
              </Pressable>
              {open.has(NOISE) && <View style={styles.members}>{liveNoise.map(row)}</View>}
            </View>
          )}
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
  back: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  // 갈래 세그먼티드 — 칩과 같은 팔레트를 쓰되 한 덩어리로 붙여서 "둘 중 하나"임을 보인다
  seg: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: rounded.chip,
    overflow: 'hidden',
  },
  segCell: { paddingHorizontal: spacing.sm, paddingVertical: 5 },
  segCellOn: { backgroundColor: colors.ink },
  segLabel: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  segLabelOn: { color: colors.onInk },
  refresh: { ...type.bodyMd, color: colors.link, fontFamily: fonts.sansMedium },
  refreshDisabled: { color: colors.faint },
  // 헤매기의 필터 칩과 같은 문법 — 켜면 채워진다
  optionRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, alignItems: 'flex-start' },
  option: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  optionOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  optionLabel: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  optionLabelOn: { color: colors.onInk },
  metaRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, gap: 2 },
  meta: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  metaWarn: { ...type.bodySm, color: colors.ink, fontFamily: fonts.sans },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  centerText: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxxl },
  // 카드 박스를 안 쓴다 — DailyView의 시간대 구분선과 같은 문법. FragmentBullet은 canvas
  // 바탕에 바로 놓이게 만든 컴포넌트라 elevated 카드 안에 넣으면 행마다 배경이 도드라진다.
  group: { paddingTop: spacing.lg },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairlineSoft,
  },
  headLabel: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium, flex: 1 },
  noiseLabel: { color: colors.mute },
  count: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono },
  chevron: { ...type.bodySm, color: colors.faint, fontFamily: fonts.mono },
  members: { marginTop: spacing.xxs },
});
