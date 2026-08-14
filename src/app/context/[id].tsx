import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
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
import { confirmDelete } from '@/lib/confirm';
import {
  deleteContextCard,
  getContextCard,
  updateContextCard,
  type ContextCard,
} from '@/lib/context';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';

// 맥락 카드 편집 — 제목 + 본문. 그게 다다.
//
// 본문 형식은 강요하지 않는다(템플릿을 씌우면 안 채우게 된다). 대신 제목을 잘 쓰게 유도한다 —
// 꺼낼 때 모델이 "이 요청에 이 카드가 필요한가"를 제목으로 판단하기 때문이다.
//
// 저장은 blur + 뒤로가기 양쪽에서 한다. blur만 걸면 긴 본문을 쓰다가 바로 뒤로 눌렀을 때
// 통째로 날아간다 — 여기는 한 번에 길게 쓰는 화면이라 그 경로가 실제로 자주 생긴다.
export default function ContextCardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [card, setCard] = useState<ContextCard | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // 저장 대상은 항상 최신 입력값이어야 한다 — 뒤로가기 핸들러가 옛 클로저를 잡으면 안 된다.
  const draft = useRef({ title: '', body: '' });
  draft.current = { title, body };

  useEffect(() => {
    if (!id) return;
    getContextCard(id)
      .then((c) => {
        setCard(c);
        setTitle(c.title);
        setBody(c.body);
      })
      .catch(() => {});
  }, [id]);

  if (!card) return <SafeAreaView style={styles.screen} />;

  async function save() {
    const next = draft.current;
    if (next.title === card!.title && next.body === card!.body) return;
    await updateContextCard(card!.id, next);
    setCard({ ...card!, ...next });
  }

  function back() {
    save().catch(() => {});
    router.back();
  }

  async function remove() {
    if (!(await confirmDelete('이 맥락 카드를 지울까?'))) return;
    await deleteContextCard(card!.id);
    router.back();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={back} hitSlop={12}>
            <Text style={styles.headerBtn}>‹ 뒤로</Text>
          </Pressable>
          <Pressable onPress={remove} hitSlop={12}>
            <Text style={styles.deleteBtn}>삭제</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TextInput
            style={[styles.title, noFocusRing]}
            value={title}
            onChangeText={setTitle}
            onBlur={() => save().catch(() => {})}
            autoFocus={!card.title && !card.body}
            placeholder="프로젝트/Mind"
            placeholderTextColor={colors.faint}
            keyboardAppearance="dark"
          />
          <Text style={styles.titleHint}>
            꺼낼 때 이 제목으로 고른다 — 종류/이름 형태가 제일 잘 걸린다
          </Text>

          <TextInput
            style={[styles.body, noFocusRing]}
            value={body}
            onChangeText={setBody}
            onBlur={() => save().catch(() => {})}
            multiline
            placeholder="뭘 만들었는지, 언제였는지, 어떤 결정을 했는지…"
            placeholderTextColor={colors.faint}
            keyboardAppearance="dark"
          />
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
    padding: spacing.md,
  },
  headerBtn: { ...type.labelSm, color: colors.mute, fontFamily: fonts.sans },
  deleteBtn: { ...type.labelSm, color: colors.error, fontFamily: fonts.sans },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxxl },
  title: {
    ...type.headingMd,
    color: colors.ink,
    fontFamily: fonts.sansSemiBold,
    padding: 0,
  },
  titleHint: {
    ...type.bodySm,
    color: colors.faint,
    fontFamily: fonts.sans,
    marginTop: spacing.xxs,
    marginBottom: spacing.lg,
  },
  // 한 번에 길게 쓰는 자리라 읽기 전용 행간(readingMd)을 쓴다
  body: {
    ...type.readingMd,
    color: colors.ink,
    fontFamily: fonts.sans,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    padding: spacing.sm,
    minHeight: 320,
    textAlignVertical: 'top',
  },
});
