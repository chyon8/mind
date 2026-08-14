import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { summonContext } from '@/lib/context';
import { Markdown } from '@/lib/markdown';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';

// 뭘 물어볼 수 있는지 화면이 직접 보여준다. 탭하면 입력창에 채워지고(전송은 따로) —
// 요청 문장을 다듬는 게 결과 품질의 전부라 한 번 고칠 자리를 준다.
const EXAMPLES = [
  '이력서용으로 커리어 정리해줘',
  'Mind 프로젝트 설명해줘, 기술적인 것 위주로',
  '나에 대해 간단히 소개하는 문단 하나',
  '지금 진행중인 것들만',
];

// 맥락 꺼내기 — 카드 전량 + 요청 → 요약 한 덩어리 → 복사.
//
// 결과의 목적지는 **다른 AI의 대화창**이다. 여기서 읽는 게 아니라 복사해서 나가는 물건이라
// 복사 버튼이 결과 맨 위에 있다.
export default function ContextSummon() {
  const [request, setRequest] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async () => {
    const text = request.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await summonContext(text));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [request, busy]);

  function copy() {
    if (!result) return;
    Clipboard.setString(result);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 뒤로</Text>
          </Pressable>
          <Text style={styles.wordmark}>맥락 꺼내기</Text>
          <View style={styles.headerRight} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TextInput
            style={[styles.input, noFocusRing]}
            value={request}
            onChangeText={setRequest}
            placeholder="어떻게 정리해줄까?"
            placeholderTextColor={colors.faint}
            multiline
            autoFocus
            keyboardAppearance="dark"
          />

          <View style={styles.examples}>
            {EXAMPLES.map((e) => (
              <Pressable key={e} style={styles.example} onPress={() => setRequest(e)}>
                <Text style={styles.exampleText}>{e}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={run}
            disabled={!request.trim() || busy}
            style={[styles.runBtn, (!request.trim() || busy) && styles.runBtnOff]}
          >
            <Text style={styles.runLabel}>{busy ? '정리하는 중…' : '꺼내기'}</Text>
          </Pressable>

          {busy && <ActivityIndicator color={colors.faint} style={styles.spinner} />}
          {error && <Text style={styles.errorText}>{error}</Text>}

          {result && (
            <View style={styles.resultWrap}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultLabel}>결과</Text>
                <Pressable onPress={copy} style={styles.copyBtn} hitSlop={8}>
                  <Text style={styles.copyLabel}>{copied ? '복사됨' : '복사'}</Text>
                </Pressable>
              </View>
              <View style={styles.resultBody}>
                <Markdown text={result} />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerBtn: { ...type.labelSm, color: colors.mute, fontFamily: fonts.sans },
  headerRight: { minWidth: 48 },
  wordmark: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },

  scroll: { padding: spacing.md, paddingBottom: spacing.xxxl },
  input: {
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.md,
    padding: spacing.sm,
    minHeight: 80,
    maxHeight: 160,
    textAlignVertical: 'top',
  },
  examples: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  example: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  exampleText: { ...type.bodySm, color: colors.body, fontFamily: fonts.sans },

  runBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.ink,
    borderRadius: rounded.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  runBtnOff: { opacity: 0.35 },
  runLabel: { ...type.bodyMd, color: colors.onInk, fontFamily: fonts.sansMedium },
  spinner: { marginTop: spacing.lg },
  errorText: {
    ...type.bodySm,
    color: colors.error,
    fontFamily: fonts.sans,
    marginTop: spacing.md,
  },

  resultWrap: { marginTop: spacing.xl, gap: spacing.sm },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultLabel: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },
  copyBtn: {
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  copyLabel: { ...type.bodySm, color: colors.body, fontFamily: fonts.sansMedium },
  resultBody: {
    borderLeftColor: colors.hairline,
    borderLeftWidth: 2,
    paddingLeft: spacing.md,
  },
});
