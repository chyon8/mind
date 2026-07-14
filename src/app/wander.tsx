import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FragmentCard } from '@/components/FragmentCard';
import { fetchDayIndex, fetchFragmentsByIds } from '@/lib/supabase';
import { colors, fonts, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';
import { vividness } from '@/lib/vividness';

// 헤매기 — 무작위로 계속 흘러나온다. 딴생각하며 머릿속을 거니는 것에 가깝다.
//
// **판단 버튼이 없다.** 무한히 뽑을 수 있는 곳에 기억하기/흘려보내기를 붙이면
// 결국 보관함 전체를 솎아내는 노동이 된다 — SPEC §7이 금지한 정리 스와이프다.
// 지나가는 것만으론 아무 일도 안 일어나고, 마음이 가서 탭해 열면 그때 선명해진다
// (스스로 찾아간 것이므로 정당한 touch다). 판단하는 자리는 데일리의 "떠오른 것" 하나뿐.
//
// 나란히 놓인 두 파편 사이의 연결은 저장하지 않는다. 연결은 당신 머릿속에서 일어난다.
const CHUNK = 8;

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
  const loading = useRef(false);

  // 끝이 없다. 한 바퀴를 다 돌면 다시 섞어서 계속 흐른다 —
  // 헤매기는 끝내야 할 목록이 아니다.
  const more = useCallback(async () => {
    if (loading.current || pool.current.length === 0) return;
    loading.current = true;
    try {
      // 파편이 CHUNK보다 적으면 한 번에 그만큼만 — 같은 게 연달아 여덟 번 나오면 안 된다
      const take = Math.min(CHUNK, pool.current.length);
      const ids: string[] = [];
      while (ids.length < take) {
        if (deck.current.length === 0) {
          deck.current = shuffle(pool.current);
          // 바퀴가 넘어가는 자리에서 같은 파편이 연달아 나오지 않게
          const lastId = ids[ids.length - 1] ?? items[items.length - 1]?.id;
          if (deck.current.length > 1 && deck.current[0] === lastId) {
            [deck.current[0], deck.current[1]] = [deck.current[1], deck.current[0]];
          }
        }
        ids.push(deck.current.shift()!);
      }
      const frs = await fetchFragmentsByIds([...new Set(ids)]);
      // 조회는 순서를 보장하지 않는다 — 섞어둔 순서대로 되돌린다
      const byId = new Map(frs.map((fr) => [fr.id, fr]));
      setItems((prev) => [...prev, ...ids.map((id) => byId.get(id)).filter((fr) => fr != null)]);
    } catch {
      // 한 번 실패해도 다음 스크롤에서 다시 시도한다
    } finally {
      loading.current = false;
    }
  }, [items]);

  useEffect(() => {
    fetchDayIndex('all')
      .then((index) => {
        pool.current = index.map((m) => m.id);
        if (pool.current.length === 0) setEmpty(true);
        else more();
      })
      .catch(() => setEmpty(true));
    // 최초 1회만 — more는 스크롤이 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </Pressable>
        <Text style={styles.title}>헤매기</Text>
        <View style={styles.spacer} />
      </View>

      <FlatList
        data={items}
        // 바퀴가 돌면 같은 파편이 다시 나온다 — id만으론 키가 겹친다
        keyExtractor={(fr, i) => `${fr.id}-${i}`}
        contentContainerStyle={styles.list}
        onEndReached={more}
        onEndReachedThreshold={0.6}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/fragment/${item.id}`)}>
            <FragmentCard fragment={item} opacity={Math.max(vividness(item), READABLE_FLOOR)} />
          </Pressable>
        )}
        ListEmptyComponent={
          empty ? <Text style={styles.empty}>헤맬 것이 아직 없다</Text> : null
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
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxxl },
  empty: {
    ...type.bodyMd,
    color: colors.mute,
    fontFamily: fonts.sans,
    textAlign: 'center',
    paddingTop: spacing.xxl,
  },
});
