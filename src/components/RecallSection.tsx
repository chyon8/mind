import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { FragmentCard } from '@/components/FragmentCard';
import { dayKey } from '@/lib/dates';
import { currentRecall, recallSeed, recallUtteranceId } from '@/lib/recall';
import { letGoFragment, recordUtteranceResponse, rememberFragment } from '@/lib/supabase';
import { colors, fonts, spacing, type } from '@/lib/theme';
import type { Fragment } from '@/lib/types';

// "왜 지금" 한 줄 — 씨앗 파편을 짧게 가리킨다. 링크 파편은 URL 대신 제목으로.
function seedLabel(seed: Fragment): string {
  const raw = (seed.link_title || seed.content || '').replace(/\s+/g, ' ').trim();
  const title = raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
  const when = dayKey(seed.created_at) === dayKey(new Date().toISOString()) ? '오늘' : '며칠 새';
  return `${when} 던진 『${title}』와 닿아 있어`;
}

// SPEC §5의 없어진 반쪽. 감쇠만 있고 회상이 없으면 그건 기억이 아니라 소멸이다.
//
// 별도 화면으로 만들지 않는다 — 가야 하는 곳이 되는 순간 안 가게 된다.
// 이미 가는 곳(오늘의 데일리)에, 오늘 파편들 아래에 조용히 놓인다.
//
// 2026-08-01: **카드를 탭하면 상세로 간다.** 전엔 막아뒀는데("상세는 열리는 순간 touch된다"),
// 그 전제가 2026-07-19에 이미 깨졌다 — 파편 상세는 그 뒤로 **여는 것만으론 touch하지 않고**
// 실질 편집(내용·덧붙임·tier·프로젝트)이 있을 때만 touch한다(fragment/[id].tsx 확인).
// 그래서 "그냥 봤다고 선명해지면 안 된다"(SPEC §5-1)는 그대로 지켜진다.
export function RecallSection({ visible }: { visible: boolean }) {
  const [items, setItems] = useState<Fragment[]>([]);
  // 충돌로 올라온 파편과 그 씨앗. 평소엔 안 보이고 탭해야 읽힌다 (§4-A1 요청 시 가시성).
  const [why, setWhy] = useState<{ fragmentId: string; seed: Fragment } | null>(null);
  const [shown, setShown] = useState(false);

  const load = useCallback(() => {
    currentRecall()
      .then(setItems)
      .catch(() => {});
    setShown(false);
    recallSeed()
      .then(setWhy)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // 판이 4시간마다 갈리므로 앱을 켜둔 채 넘어가는 경우가 실제로 생긴다.
  // 돌아올 때마다 다시 읽는다 — 아직 같은 판이면 currentRecall이 저장된 판을 그대로 돌려준다.
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [visible, load]);

  if (!visible || items.length === 0) return null; // 없으면 그냥 없는 것이다

  function drop(id: string) {
    setItems((prev) => prev.filter((fr) => fr.id !== id));
  }

  // 루디가 되살린 파편이었다면 그 판단은 루디에 대한 평가다 (§6-6).
  // 랜덤으로 뜬 것에 대한 반응은 루디 것이 아니므로 아무것도 적지 않는다.
  async function record(fragmentId: string, response: 'acted' | 'dismissed') {
    const id = await recallUtteranceId(fragmentId);
    if (id) await recordUtteranceResponse(id, response);
  }

  async function remember(fr: Fragment) {
    drop(fr.id);
    await rememberFragment(fr); // 선명도 100% 복귀 + 중요도 한 칸
    await record(fr.id, 'acted');
  }

  async function letGo(fr: Fragment) {
    drop(fr.id);
    await letGoFragment(fr.id); // 지우지 않는다. 계속 흐려지게 둘 뿐이다.
    await record(fr.id, 'dismissed');
  }

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>떠오른 것</Text>
      {items.map((fr) => (
        <View key={fr.id} style={styles.item}>
          {/* 카드 탭 = 상세로. 열어도 touch되지 않으므로 선명해지지 않는다. */}
          <Pressable onPress={() => router.push(`/fragment/${fr.id}`)}>
            <FragmentCard fragment={fr} opacity={1} />
          </Pressable>
          {why?.fragmentId === fr.id && shown && (
            <Text style={styles.why}>{seedLabel(why.seed)}</Text>
          )}
          <View style={styles.actions}>
            {/* "왜 지금"은 카드에서 떼어 여기로 왔다 — 카드 탭이 상세로 갔으므로 (§4-A1 요청 시 가시성) */}
            {why?.fragmentId === fr.id && (
              <Pressable onPress={() => setShown((v) => !v)} hitSlop={8}>
                <Text style={styles.whyBtn}>왜 지금?</Text>
              </Pressable>
            )}
            <View style={styles.spacer} />
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
  // 조용한 각주 — 궁금해서 눌렀을 때만 나타난다
  why: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // "왜 지금?"은 왼쪽, 판단 버튼은 오른쪽 — 사이를 이게 민다
  spacer: { flex: 1 },
  whyBtn: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans },
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
