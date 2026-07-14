import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FragmentCard } from '@/components/FragmentCard';
import { todayRecall } from '@/lib/recall';
import { letGoFragment, rememberFragment } from '@/lib/supabase';
import { colors, fonts, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';

// SPEC §5의 없어진 반쪽. 감쇠만 있고 회상이 없으면 그건 기억이 아니라 소멸이다.
//
// 별도 화면으로 만들지 않는다 — 가야 하는 곳이 되는 순간 안 가게 된다.
// 이미 가는 곳(오늘의 데일리)에, 오늘 파편들 아래에 조용히 놓인다.
//
// 카드는 상세로 넘어가지 않는다. 상세는 열리는 순간 touch되어 선명해지므로,
// 링크를 걸면 "그냥 봤다고 선명해지면 안 된다"는 원칙이 뒷문으로 깨진다.
export function RecallSection({ visible }: { visible: boolean }) {
  const [items, setItems] = useState<Fragment[]>([]);

  const load = useCallback(() => {
    todayRecall()
      .then(setItems)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  if (!visible || items.length === 0) return null; // 없으면 그냥 없는 것이다

  function drop(id: string) {
    setItems((prev) => prev.filter((fr) => fr.id !== id));
  }

  async function remember(fr: Fragment) {
    drop(fr.id);
    await rememberFragment(fr); // 선명도 100% 복귀 + 중요도 한 칸
  }

  async function letGo(fr: Fragment) {
    drop(fr.id);
    await letGoFragment(fr.id); // 지우지 않는다. 계속 흐려지게 둘 뿐이다.
  }

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>떠오른 것</Text>
      {items.map((fr) => (
        <View key={fr.id} style={styles.item}>
          <FragmentCard fragment={fr} opacity={1} />
          <View style={styles.actions}>
            <Pressable onPress={() => letGo(fr)} hitSlop={8}>
              <Text style={styles.letGo}>흘려보내기</Text>
            </Pressable>
            <Pressable onPress={() => remember(fr)} hitSlop={8} style={styles.rememberBtn}>
              <Text style={styles.remember}>기억하기</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl, gap: spacing.md },
  eyebrow: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },
  item: { gap: spacing.xs },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  // 흘려보내기가 기본값처럼 조용하다 — 대부분은 그대로 가라앉는 게 맞다
  letGo: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  rememberBtn: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 100,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
  remember: { ...type.bodySm, color: colors.ink, fontFamily: fonts.sansMedium },
});
