import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { feedDateLabel, formatTime } from '@/lib/dates';
import { Markdown } from '@/lib/markdown';
import { type Briefing, deleteBriefing, fetchBriefings, streamBriefing, type BriefStage } from '@/lib/rudy';
import { existingFragmentContents, insertFragment } from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';

// 발견 브리핑 (RUDY.md §4-E · §7-4). 당기는 표면 — 내가 열 때만 바깥을 물어온다.
//
// 열면 **기록 목록**부터 보여준다 — 바로 생성하지 않는다. 지난 것을 고르거나 `새로 발견하기`를 눌러야 생성.
// 생성은 스트리밍(단계 스테퍼 + 카드가 차오름). **화면을 나가도 생성은 백그라운드에서 끝까지 돌아
// 원장에 저장된다** — 다시 열면 기록에 있다(중간에 나가도 유실 없음).


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
// ※ 로 시작하는 줄(버린 것 각주)은 카드에 섞지 않고 별도 각주로 뺀다(유저 요청).
function parseCards(md: string): { title: string; body: string }[] {
  const cards: { title: string; body: string }[] = [];
  let cur: { title: string; body: string } | null = null;
  for (const ln of md.split('\n')) {
    const h = ln.match(/^###\s+(.+)/);
    if (h) {
      cur = { title: h[1].trim(), body: '' };
      cards.push(cur);
    } else if (ln.trimStart().startsWith('※')) {
      cards.push({ title: '', body: ln.replace(/^\s*※\s*/, '').trim() });
      cur = null; // 각주 이후는 카드에 안 붙는다
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + ln;
    } else if (ln.trim()) {
      cards.push({ title: '', body: ln });
    }
  }
  return cards.map((c) => ({ title: c.title, body: c.body.trim() })).filter((c) => c.title || c.body);
}

const firstTitle = (md: string) => parseCards(md).find((c) => c.title)?.title ?? '(제목 없음)';

// 카드 하나 — 처음 나타날 때 페이드+슬라이드. index를 key로 쓰므로 마지막 카드는 자라기만 한다.
// 던지기(§4-E4 플라이휠): 발견 인사이트를 그대로 Mind 파편으로. 임베딩돼서 다음 충돌·클러스터에 참여한다.
function Card({
  title,
  body,
  thrown,
  onThrow,
}: {
  title: string;
  body: string;
  thrown: boolean;
  onThrow: () => void;
}) {
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
      <Pressable onPress={onThrow} disabled={thrown} hitSlop={6} style={styles.throw}>
        <Text style={[styles.throwText, thrown && styles.thrownText]}>
          {thrown ? '던졌다 ✓' : '↑ 던지기'}
        </Text>
      </Pressable>
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

type Mode = 'home' | 'result';
type ResultKind = 'live' | 'saved' | 'empty' | 'error';

export default function Discovery() {
  const [mode, setMode] = useState<Mode>('home');
  const [gen, setGen] = useState(false); // 생성 진행 중 (화면을 나가도 유지 — 서버는 계속 돈다)
  const [kind, setKind] = useState<ResultKind>('live');
  const [stage, setStage] = useState<BriefStage>('reading');
  const [count, setCount] = useState<number>();
  const [md, setMd] = useState('');
  const [error, setError] = useState('');
  const [list, setList] = useState<Briefing[]>([]);
  // 화면이 떠 있는 동안만 setState. 나가도 생성은 백그라운드에서 계속 돌아 저장된다(유실 방지).
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

  // 던지기(§4-E4) 상태. 화면을 나갔다 와도 이미 던진 카드는 "던졌다"로 뜨게 DB에서 복원한다.
  const [thrown, setThrown] = useState<Set<string>>(new Set());
  const syncThrown = useCallback((text: string) => {
    const titles = parseCards(text).map((c) => c.title).filter(Boolean);
    if (!titles.length) return;
    existingFragmentContents(titles)
      .then((hit) => alive.current && setThrown((s) => new Set([...s, ...hit])))
      .catch(() => {});
  }, []);

  // 새 브리핑 생성 (스트리밍). ⚠️ signal을 안 넘긴다 — 나가도 서버가 끝까지 만들어 저장하게.
  const generate = useCallback(() => {
    if (gen) return; // 이미 생성 중이면 무시 (버튼 잠금)
    setGen(true);
    setKind('live');
    setStage('reading');
    setCount(undefined);
    setMd('');
    setError('');
    setMode('result');

    streamBriefing({
      onStage: (s, n) => {
        if (!alive.current) return;
        setStage(s);
        setCount(n);
      },
      // md는 화면을 나가도 갱신한다(돌아오면 최신). phase(모드)는 안 건드린다 — 유저가 목록에 있으면 목록 유지.
      onToken: (t) => alive.current && setMd((prev) => prev + t),
    })
      .then(({ empty }) => {
        if (alive.current) {
          setGen(false);
          setKind(empty ? 'empty' : 'live');
          setMd((cur) => {
            syncThrown(cur); // 완성 시 이미 던진 게 있으면 상태 복원
            return cur;
          });
        }
        refreshList(); // 완성분이 원장에 저장됐다 — 목록 갱신
      })
      .catch((e) => {
        if (alive.current) {
          setGen(false);
          setError(String(e?.message ?? e));
          setKind('error');
        }
      });
  }, [gen, refreshList, syncThrown]);

  // 열 때: 기록 목록을 읽어 보여준다. 바로 생성하지 않는다.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    refreshList();
  }, [refreshList]);

  const view = useCallback(
    (b: Briefing) => {
      setMd(b.text);
      setKind('saved');
      setMode('result');
      syncThrown(b.text);
    },
    [syncThrown],
  );

  const remove = useCallback(
    (b: Briefing) => {
      setList((cur) => cur.filter((x) => x.id !== b.id)); // 낙관적 제거
      deleteBriefing(b.id).catch(() => refreshList()); // 실패하면 되돌린다
    },
    [refreshList],
  );

  // note엔 링크 마크업을 평문으로 눕혀서 넣는다 — 덧붙임은 읽는 글이지 링크가 아니다.
  const throwCard = useCallback((title: string, body: string) => {
    setThrown((s) => new Set(s).add(title));
    const note = body.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)').trim() || null;
    insertFragment({ content: title, type: 'text', note }).catch(() =>
      setThrown((s) => {
        const n = new Set(s);
        n.delete(title);
        return n;
      }),
    );
  }, []);

  const cards = mode === 'result' && kind !== 'empty' && kind !== 'error' ? parseCards(md) : [];
  const showStepper = mode === 'result' && kind === 'live' && !md;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        {mode === 'home' ? (
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 뒤로</Text>
          </Pressable>
        ) : (
          // 목록으로 가도 생성은 abort 안 함 — 백그라운드에서 계속 만들어 저장된다.
          <Pressable onPress={() => setMode('home')} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 목록</Text>
          </Pressable>
        )}
        <Text style={styles.wordmark}>발견</Text>
        <View style={styles.headerRight}>
          {gen && <Text style={styles.genPill}>생성 중</Text>}
        </View>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
        {mode === 'home' && (
          <>
            <Pressable
              style={[styles.generate, gen && styles.generateOff]}
              onPress={generate}
              disabled={gen}
            >
              <Text style={styles.generateText}>{gen ? '생성 중…' : '새로 발견하기'}</Text>
              <Text style={styles.generateSub}>
                {gen ? '다 되면 기록에 얹힌다 · 나가도 계속 돈다' : '바깥에서 물어온다 · 30초쯤'}
              </Text>
            </Pressable>
            {list.length === 0 && <Text style={styles.emptyList}>아직 기록이 없다. 위 버튼으로 시작.</Text>}
            {list.map((b) => (
              <Pressable key={b.id} style={styles.histRow} onPress={() => view(b)}>
                <View style={styles.flex}>
                  <Text style={styles.histDate}>
                    {feedDateLabel(b.created_at)} · {formatTime(b.created_at)}
                  </Text>
                  <Text style={styles.histSnip} numberOfLines={1}>
                    {firstTitle(b.text)}
                  </Text>
                </View>
                <Pressable onPress={() => remove(b)} hitSlop={10} style={styles.histDel}>
                  <Text style={styles.histDelText}>지우기</Text>
                </Pressable>
              </Pressable>
            ))}
          </>
        )}

        {showStepper && <Stepper stage={stage} count={count} />}

        {cards.map((c, i) => (
          <Card
            key={i}
            title={c.title}
            body={c.body}
            thrown={thrown.has(c.title)}
            onThrow={() => throwCard(c.title, c.body)}
          />
        ))}

        {mode === 'result' && kind === 'empty' && (
          <View style={styles.center}>
            <Text style={styles.hint}>오늘은 가져올 만한 게 없다.</Text>
            <Text style={styles.hintSmall}>없는 날은 없다고 말한다.</Text>
          </View>
        )}

        {mode === 'result' && kind === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorText}>못 가져왔다.</Text>
            <Text style={styles.hintSmall}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => setMode('home')}>
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
  throw: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  throwText: { ...type.bodySm, color: colors.body, fontFamily: fonts.sansMedium },
  thrownText: { color: colors.faint },

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

  genPill: { ...type.bodySm, color: colors.mute, fontFamily: fonts.mono, letterSpacing: 1 },

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
  generateOff: { opacity: 0.6 },
  generateText: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansSemiBold },
  generateSub: { ...type.bodySm, color: colors.mute, fontFamily: fonts.sans },
  emptyList: { ...type.bodyMd, color: colors.faint, fontFamily: fonts.sans, textAlign: 'center', paddingTop: spacing.lg },

  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  histDate: { ...type.bodySm, color: colors.mute, fontFamily: fonts.mono, marginBottom: spacing.xxs },
  histSnip: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium },
  histDel: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs },
  histDelText: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans },
});
