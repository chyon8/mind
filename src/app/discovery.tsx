import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Markdown } from '@/lib/markdown';
import { streamBriefing, type BriefStage } from '@/lib/rudy';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 발견 브리핑 (RUDY.md §4-E · §7-4). 당기는 표면 — 내가 열 때만 바깥을 물어온다.
//
// 조립이 gpt-5.5 대용량이라 30~60초. 그 시간을 못 줄이는 대신 (1) 단계 스테퍼로 진행을 보여주고
// (2) 브리핑을 토큰 스트리밍해서 카드가 하나씩 차오르게 한다 — 기다림이 "딱딱 나오는" 걸로 바뀐다.

type Phase = 'idle' | 'loading' | 'streaming' | 'done' | 'empty' | 'error';

const STAGES: { id: BriefStage; label: (n?: number) => string }[] = [
  { id: 'reading', label: () => '저장한 걸 읽는 중' },
  { id: 'angles', label: () => '뭘 찾을지 고르는 중' },
  { id: 'search', label: (n) => `바깥 ${n ?? ''}곳 뒤지는 중` },
  { id: 'writing', label: () => '브리핑 쓰는 중' },
];

function openLink(href: string) {
  if (/^https?:\/\//.test(href)) Linking.openURL(href).catch(() => {});
}

// 스트리밍 마크다운을 카드로 쪼갠다 — ### 제목마다 한 장. 스트리밍 중 미완성이어도 안 죽는다.
function parseCards(md: string): { title: string; body: string }[] {
  const cards: { title: string; body: string }[] = [];
  let cur: { title: string; body: string } | null = null;
  for (const ln of md.split('\n')) {
    const h = ln.match(/^###\s+(.+)/);
    if (h) {
      cur = { title: h[1].trim(), body: '' };
      cards.push(cur);
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + ln;
    } else if (ln.trim()) {
      cur = { title: '', body: ln };
      cards.push(cur);
    }
  }
  return cards.map((c) => ({ title: c.title, body: c.body.trim() }));
}

// 카드 하나 — 처음 나타날 때 페이드+슬라이드. index를 key로 쓰므로 마지막 카드는 자라기만 한다.
function Card({ title, body }: { title: string; body: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);
  const style = {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };
  // 제목 없는 조각(맨 끝 거절 한 줄 등)은 카드 아닌 각주로
  if (!title) {
    return (
      <Animated.View style={style}>
        <Text style={styles.footnote}>{body}</Text>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[styles.card, style]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {!!body && <Markdown text={body} onLink={openLink} />}
    </Animated.View>
  );
}

// 단계 스테퍼 — 지금 뭐 하는 중인지. 지난 단계는 흐리게, 현재는 점이 숨쉰다.
function Stepper({ stage, count }: { stage: BriefStage; count?: number }) {
  const idx = STAGES.findIndex((s) => s.id === stage);
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.stepper}>
      {STAGES.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
        return (
          <View key={s.id} style={styles.step}>
            {state === 'active' ? (
              <Animated.View style={[styles.dot, styles.dotActive, { opacity: pulse }]} />
            ) : (
              <View style={[styles.dot, state === 'done' && styles.dotDone]} />
            )}
            <Text style={[styles.stepLabel, state === 'active' && styles.stepLabelActive, state === 'todo' && styles.stepLabelTodo]}>
              {s.label(count)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function Discovery() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<BriefStage>('reading');
  const [count, setCount] = useState<number>();
  const [md, setMd] = useState('');
  const [error, setError] = useState('');
  const started = useRef(false);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(() => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase('loading');
    setStage('reading');
    setCount(undefined);
    setMd('');
    setError('');

    streamBriefing(
      {
        onStage: (s, n) => {
          setStage(s);
          setCount(n);
        },
        onToken: (t) => {
          setPhase('streaming');
          setMd((prev) => prev + t);
        },
      },
      ctrl.signal,
    )
      // 서버의 empty가 진실 — 각도가 안 서면 토큰 없이 done(empty). 아니면 스트리밍 끝 = done.
      .then(({ empty }) => setPhase(empty ? 'empty' : 'done'))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(String(e?.message ?? e));
        setPhase('error');
      });
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = phase === 'streaming' || phase === 'done' ? parseCards(md) : [];
  const busy = phase === 'loading' || phase === 'streaming';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBtn}>‹ 뒤로</Text>
        </Pressable>
        <Text style={styles.wordmark}>발견</Text>
        <Pressable onPress={run} hitSlop={12} disabled={busy}>
          <Text style={[styles.headerBtn, busy && styles.headerBtnOff]}>새로</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
        {phase === 'loading' && <Stepper stage={stage} count={count} />}

        {cards.map((c, i) => (
          <Card key={i} title={c.title} body={c.body} />
        ))}

        {phase === 'empty' && (
          <View style={styles.center}>
            <Text style={styles.hint}>오늘은 가져올 만한 게 없다.</Text>
            <Text style={styles.hintSmall}>없는 날은 없다고 말한다.</Text>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorText}>못 가져왔다.</Text>
            <Text style={styles.hintSmall}>{error}</Text>
            <Pressable style={styles.retry} onPress={run}>
              <Text style={styles.retryText}>다시</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wordmark: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 2 },
  headerBtn: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  headerBtnOff: { color: colors.faint },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },

  // 카드
  card: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.md ?? 14,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardTitle: {
    ...type.headingMd,
    color: colors.ink,
    fontFamily: fonts.sansSemiBold,
    marginBottom: spacing.xxs,
  },
  footnote: {
    ...type.bodySm,
    color: colors.faint,
    fontFamily: fonts.sans,
    fontStyle: 'italic',
    paddingHorizontal: spacing.xs,
  },

  // 스테퍼
  stepper: { gap: spacing.md, paddingTop: spacing.xl, paddingHorizontal: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.hairline },
  dotActive: { backgroundColor: colors.ink },
  dotDone: { backgroundColor: colors.mute },
  stepLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  stepLabelActive: { color: colors.ink, fontFamily: fonts.sansMedium },
  stepLabelTodo: { color: colors.faint },

  // 상태
  center: { alignItems: 'center', paddingTop: spacing.xl * 2, gap: spacing.sm },
  hint: { ...type.bodyLg, color: colors.body, fontFamily: fonts.sans },
  hintSmall: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans, textAlign: 'center' },
  errorText: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium },
  retry: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryText: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
});
