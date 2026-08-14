// "무리" — 살아있는 파편을 유사도로 묶어서 본다 (2026-08-12).
//
// 판단 버튼 없음 — 헤매기와 같은 규칙(SPEC §7). 탭해서 상세로 들어가면 그때 touch된다.
// 무리 소속은 저장하지 않는다 — 매번 새로 계산해서 보여줄 뿐이다 (§2-1).
//
// 머리글은 대표 파편(medoid) 한 줄 — **누르면 펼치기만 한다.** 대표를 여는 Pressable을 머리글
// 안에 겹쳐 넣었다가 탭이 어디로 갈지 모르게 됐었다(2026-08-12). 파편을 열려면 펼친 목록에서
// 그 줄을 직접 누른다. 대표도 그 목록 안에 그대로 들어 있다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FragmentBullet } from '@/components/FragmentBullet';
import { fetchFragmentsByIds, fetchGroups, type FragmentGroup } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { vividness } from '@/lib/vividness';

const NOISE = 'noise'; // 접힘 상태 맵에서 "안 묶인 것" 섹션의 자리

// 헤매기에서 칩을 길게 눌러 빼둔 프로젝트 (wander.tsx가 쓰는 그 키를 읽기만 한다).
const EXCLUDE_KEY = 'wander.excluded';
// 그 제외를 무리에도 적용할지 — 무리와 헤매기는 보는 자리가 달라 따로 켜고 끈다.
const APPLY_KEY = 'groups.applyExclude';

// 머리글 한 줄 — FragmentBullet이 뽑는 줄과 같은 규칙(링크는 제목, 이미지는 캡션).
function headLine(fr: Fragment): string {
  if (fr.type === 'link') return fr.link_title ?? fr.content;
  if (fr.type === 'image') return fr.content || '(이미지)';
  return fr.content.replace(/\n/g, ' ');
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
  // 저장된 값이 도착하기 전에 첫 묶기를 시작하면 조건이 안 먹은 결과가 나온다 (wander.tsx와 같은 함정)
  const [hydrated, setHydrated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { groups: g, noiseIds: n } = await fetchGroups(applyExclude ? excluded : []);
      const frs = await fetchFragmentsByIds([
        ...new Set([...g.flatMap((x) => x.memberIds), ...n]),
      ]);
      setGroups(g);
      setNoiseIds(n);
      setById(new Map(frs.map((fr) => [fr.id, fr])));
      setOpen(new Set());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [applyExclude, excluded]);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(EXCLUDE_KEY), AsyncStorage.getItem(APPLY_KEY)])
      .then(([ex, apply]) => {
        if (ex) setExcluded(JSON.parse(ex) as string[]);
        if (apply === '1') setApplyExclude(true);
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  // 토글을 바꾸면 다시 묶는다 — 무리는 저장을 안 하므로 매번 계산이 유일한 경로다.
  useEffect(() => {
    if (hydrated) load();
  }, [hydrated, load]);

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
        <Text style={styles.title}>무리</Text>
        <Pressable onPress={load} hitSlop={12} disabled={loading}>
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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.mute} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>안 됐다. 다시 눌러봐.</Text>
        </View>
      ) : groups.length === 0 && noiseIds.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>아직 묶을 게 없다</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {groups.map((g) => {
            const rep = byId.get(g.repId);
            if (!rep) return null;
            const isOpen = open.has(g.repId);
            return (
              <View key={g.repId} style={styles.group}>
                <Pressable onPress={() => toggle(g.repId)} style={styles.groupHead}>
                  <Text style={styles.headLabel} numberOfLines={1}>
                    {headLine(rep)}
                  </Text>
                  <Text style={styles.count}>{g.memberIds.length}개</Text>
                  <Text style={styles.chevron}>{isOpen ? '▴' : '▾'}</Text>
                </Pressable>
                {isOpen && <View style={styles.members}>{g.memberIds.map(row)}</View>}
              </View>
            );
          })}

          {noiseIds.length > 0 && (
            <View style={styles.group}>
              <Pressable onPress={() => toggle(NOISE)} style={styles.groupHead}>
                <Text style={[styles.headLabel, styles.noiseLabel]}>안 묶인 것</Text>
                <Text style={styles.count}>{noiseIds.length}개</Text>
                <Text style={styles.chevron}>{open.has(NOISE) ? '▴' : '▾'}</Text>
              </Pressable>
              {open.has(NOISE) && <View style={styles.members}>{noiseIds.map(row)}</View>}
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
  title: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 1 },
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
