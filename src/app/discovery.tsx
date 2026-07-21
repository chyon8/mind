import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { feedDateLabel, formatTime } from '@/lib/dates';
import { Markdown } from '@/lib/markdown';
import { type Briefing, fetchBriefings, streamBriefing, type BriefStage } from '@/lib/rudy';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 발견 브리핑 (RUDY.md §4-E · §7-4). 당기는 표면 — 내가 열 때만 바깥을 물어온다.
//
// 열면 **기록 목록**부터 보여준다 — 바로 생성하지 않는다. 지난 것을 고르거나 `새로 발견하기`를 눌러야 생성.
// 생성은 스트리밍(단계 스테퍼 + 카드가 차오름). **화면을 나가도 생성은 백그라운드에서 끝까지 돌아
// 원장에 저장된다** — 다시 열면 기록에 있다(중간에 나가도 유실 없음).

type Phase = 'init' | 'home' | 'loading' | 'streaming' | 'done' | 'empty' | 'error';

const STAGES: { id: BriefStage; label: (n?: number) => string }[] = [
  { id: 'reading', label: () => '저장한 걸 읽는 중' },
  { id: 'angles', label: () => '뭘 찾을지 고르는 중' },
  { id: 'search', label: (n) => `바깥 ${n ?? ''}곳 뒤지는 중` },
  { id: 'writing', label: () => '브리핑 쓰는 중' },
];

function openLink(href: string) {
  if (/^https?:\/\//.test(href)) Linking.openURL(href).catch(() => {});
}

// 스트리밍 마크다운을 카드로 쪼갠다 — ### 제목마다 한 장. 미완성이어도 안 죽는다.
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

const firstTitle = (md: string) => parseCards(md).find((c) => c.title)?.title ?? '(제목 없음)';

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

// 단계 스테퍼 — 지금 뭐 하는 중인지. 현재 단계 점이 숨쉰다.
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
  const [phase, setPhase] = useState<Phase>('init');
  const [stage, setStage] = useState<BriefStage>('reading');
  const [count, setCount] = useState<number>();
  const [md, setMd] = useState('');
  const [error, setError] = useState('');
  const [list, setList] = useState<Briefing[]>([]);
  // 화면이 떠 있는 동안만 setState 한다. 나가도 생성 자체는 백그라운드에서 계속 돌아 저장된다 —
  // 언마운트 후의 setState 경고만 막고, abort는 하지 않는다("나가면 유실"을 없애는 핵심).
  const alive = useRef(true);
  const started = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refreshList = useCallback(() => {
    fetchBriefings()
      .then((bs) => alive.current && setList(bs))
      .catch(() => {});
  }, []);

  // 새 브리핑 생성 (스트리밍). ⚠️ signal을 안 넘긴다 — 화면을 나가도 서버가 끝까지 만들어 저장하게.
  const generate = useCallback(() => {
    setPhase('loading');
    setStage('reading');
    setCount(undefined);
    setMd('');
    setError('');

    streamBriefing({
      onStage: (s, n) => {
        if (!alive.current) return;
        setStage(s);
        setCount(n);
      },
      onToken: (t) => {
        if (!alive.current) return;
        setPhase('streaming');
        setMd((prev) => prev + t);
      },
    })
      .then(({ empty }) => {
        // 완성되면 서버가 이미 저장했다. 목록은 백그라운드에서도 갱신 시도.
        fetchBriefings()
          .then((bs) => alive.current && setList(bs))
          .catch(() => {});
        if (alive.current) setPhase(empty ? 'empty' : 'done');
      })
      .catch((e) => {
        if (alive.current) {
          setError(String(e?.message ?? e));
          setPhase('error');
        }
      });
  }, []);

  // 열 때: **기록 목록**을 읽어 보여준다. 바로 생성하지 않는다.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetchBriefings()
      .then((bs) => {
        if (!alive.current) return;
        setList(bs);
        setPhase('home');
      })
      .catch((e) => {
        if (!alive.current) return;
        setError(String(e?.message ?? e));
        setPhase('error');
      });
  }, []);

  const goHome = useCallback(() => {
    setPhase('home');
    refreshList();
  }, [refreshList]);

  const view = useCallback((b: Briefing) => {
    setMd(b.text);
    setPhase('done');
  }, []);

  const cards = phase === 'streaming' || phase === 'done' ? parseCards(md) : [];
  const atHome = phase === 'home' || phase === 'init';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        {atHome ? (
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 뒤로</Text>
          </Pressable>
        ) : (
          // 생성 중에 눌러도 abort 안 함 — 백그라운드에서 계속 만들어 저장된다.
          <Pressable onPress={goHome} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 목록</Text>
          </Pressable>
        )}
        <Text style={styles.wordmark}>발견</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
        {atHome && (
          <>
            <Pressable style={styles.generate} onPress={generate}>
              <Text style={styles.generateText}>새로 발견하기</Text>
              <Text style={styles.generateSub}>바깥에서 물어온다 · 30초쯤</Text>
            </Pressable>
            {list.length === 0 && phase === 'home' && (
              <Text style={styles.emptyList}>아직 기록이 없다. 위 버튼으로 시작.</Text>
            )}
            {list.map((b) => (
              <Pressable key={b.id} style={styles.histRow} onPress={() => view(b)}>
                <Text style={styles.histDate}>
                  {feedDateLabel(b.created_at)} · {formatTime(b.created_at)}
                </Text>
                <Text style={styles.histSnip} numberOfLines={1}>
                  {firstTitle(b.text)}
                </Text>
              </Pressable>
            ))}
          </>
        )}

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
            <Pressable style={styles.retry} onPress={goHome}>
              <Text style={styles.retryText}>목록으로</Text>
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
  headerRight: { flexDirection: 'row', gap: spacing.md, minWidth: 44, justifyContent: 'flex-end' },
  wordmark: { ...type.monoEyebrow, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 2 },
  headerBtn: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  headerBtnOff: { color: colors.faint },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },

  card: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.md ?? 14,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardTitle: { ...type.headingMd, color: colors.ink, fontFamily: fonts.sansSemiBold, marginBottom: spacing.xxs },
  footnote: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans, fontStyle: 'italic', paddingHorizontal: spacing.xs },

  stepper: { gap: spacing.md, paddingTop: spacing.xl, paddingHorizontal: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.hairline },
  dotActive: { backgroundColor: colors.ink },
  dotDone: { backgroundColor: colors.mute },
  stepLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  stepLabelActive: { color: colors.ink, fontFamily: fonts.sansMedium },
  stepLabelTodo: { color: colors.faint },

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

  generate: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: rounded.md ?? 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: spacing.xxs,
  },
  generateText: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansSemiBold },
  generateSub: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  emptyList: { ...type.bodyMd, color: colors.faint, fontFamily: fonts.sans, textAlign: 'center', paddingTop: spacing.lg },

  histRow: {
    paddingVertical: spacing.sm,
    borderBottomColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xxs,
  },
  histDate: { ...type.bodySm, color: colors.mute, fontFamily: fonts.mono },
  histSnip: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium },
});
