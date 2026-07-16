import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fetchProjects, insertFragment } from '@/lib/supabase';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';
import { markThrown } from '@/lib/thrown';
import { detectType } from '@/lib/typeDetector';
import type { FragmentType, Project } from '@/lib/types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// 타입 드롭다운 선택지 — image는 공유(이미지 첨부)로만 들어오므로 손으로 고를 대상이 아니다.
const TYPE_OPTIONS: FragmentType[] = ['text', 'quote', 'link'];

// 타입 점 색 — 링크는 블루, 인용은 잉크 톤, 텍스트는 무채.
const TYPE_COLOR: Record<FragmentType, string> = {
  text: colors.mute,
  quote: colors.ink,
  link: colors.link,
  image: colors.mute,
};

// 화면 3: 붙여넣기/타이핑 → 타입 자동 인식(배지) → 던지기.
// transparentModal 위에 떠 있는 가운데 카드. 열릴 때 스프링으로 떠오르고,
// 던지기 성공 시 카드가 위로 날아가며 사라진다.
// 새 파편 전용 — 수정은 파편 상세 화면에서 인라인으로 한다.
// 프로젝트 선택은 접힌 옵션, 기본 Inbox (SPEC §6-3).
export default function Input() {
  // draft = 공유 저장이 실패했을 때 넘어온 원문 (확정 결정 2)
  // project = 프로젝트 상세에서 열었을 때 미리 태그할 프로젝트 (PLAN.md §6.2, [2])
  const { draft, project } = useLocalSearchParams<{ draft?: string; project?: string }>();
  const [text, setText] = useState(draft ?? '');
  const [projectIds, setProjectIds] = useState<string[]>(project ? [project] : []);
  const [projects, setProjects] = useState<Project[]>([]);
  // 프로젝트에서 열었으면 어디에 붙는지 보이도록 칩 줄을 펼친 채로 시작
  const [expanded, setExpanded] = useState(!!project);
  const [busy, setBusy] = useState(false);
  const [manualType, setManualType] = useState<FragmentType | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const progress = useSharedValue(0); // 0 닫힘 → 1 열림
  const thrown = useSharedValue(0); // 던지기 성공 → 1 (위로 날아감)

  useEffect(() => {
    progress.value = withSpring(1, { damping: 20, stiffness: 260, mass: 0.9 });
    // transparentModal에서 autoFocus가 씹히는 경우(특히 Android) 대비 — 한 번 더 포커스
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  const trimmed = text.trim();
  const detected = detectType(trimmed);
  // 수동 지정이 자동 인식을 이긴다 — 오판별은 드롭다운에서 손으로 고친다
  const activeType = manualType ?? detected;

  const projectName =
    projectIds.length === 0
      ? 'Inbox'
      : projects
          .filter((p) => projectIds.includes(p.id))
          .map((p) => p.name)
          .join(', ') || 'Inbox';

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - thrown.value),
  }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - thrown.value),
    transform: [
      { translateY: (1 - progress.value) * 28 - thrown.value * 64 },
      { scale: 0.95 + progress.value * 0.05 },
    ],
  }));

  const goBack = () => router.back();

  function close() {
    // 던지기를 안 눌러도 쓴 건 잃지 않는다 — 내용이 있으면 조용히 저장 (마찰 0 캡처)
    if (trimmed && !busy) {
      setBusy(true); // 중복 저장 방지
      insertFragment({ content: trimmed, type: activeType, project_ids: projectIds })
        .then(markThrown)
        .catch(() => {});
    }
    progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(goBack);
    });
  }

  async function submit() {
    if (!trimmed || busy) return; // 빈 입력·중복 탭 방지
    setBusy(true);
    try {
      await insertFragment({ content: trimmed, type: activeType, project_ids: projectIds });
      markThrown(); // 데일리 뷰가 오늘로 이동하도록 (PLAN §6.1)
      // 카드가 위로 날아가며 사라진다 — '던지기'의 마무리
      thrown.value = withTiming(1, { duration: 240, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(goBack);
      });
    } catch {
      // 실패 시 원문 보존 + 수동 재시도 (확정 결정 2)
      Alert.alert('던지지 못했다', '네트워크를 확인하고 다시 시도해줘.');
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <AnimatedPressable style={[styles.backdrop, backdropStyle]} onPress={close} />
      <KeyboardAvoidingView
        style={styles.centerWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.card, cardStyle]}>
          <View style={styles.cardHeader}>
            <Text style={styles.eyebrow}>새 파편</Text>
            <View>
              <Pressable
                onPress={() => setTypeOpen((v) => !v)}
                style={styles.typeToggle}
                hitSlop={8}
              >
                <View style={[styles.badgeDot, { backgroundColor: TYPE_COLOR[activeType] }]} />
                <Text style={styles.badge}>{activeType.toUpperCase()}</Text>
                <Text style={styles.caret}>{typeOpen ? '▴' : '▾'}</Text>
              </Pressable>
              {typeOpen && (
                <View style={styles.typeMenu}>
                  {TYPE_OPTIONS.map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => {
                        setManualType(t);
                        setTypeOpen(false);
                      }}
                      style={styles.typeMenuItem}
                    >
                      <View style={[styles.badgeDot, { backgroundColor: TYPE_COLOR[t] }]} />
                      <Text style={[styles.badge, t === activeType && styles.badgeActive]}>
                        {t.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>

          <TextInput
            ref={inputRef}
            style={[styles.textarea, noFocusRing]}
            multiline
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder="지금 떠오른 것…"
            placeholderTextColor={colors.faint}
            keyboardAppearance="dark"
          />

          {expanded && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.projectScroll}
            >
              <View style={styles.projectRow}>
                {[{ id: null as string | null, name: 'Inbox' }, ...projects].map((p) => {
                  const active =
                    p.id === null ? projectIds.length === 0 : projectIds.includes(p.id);
                  return (
                    <Pressable
                      key={p.id ?? 'inbox'}
                      onPress={() => {
                        // 다중 토글 — Inbox를 누르면 전부 해제 (PLAN §3.3)
                        if (p.id === null) setProjectIds([]);
                        else
                          setProjectIds((prev) =>
                            prev.includes(p.id!)
                              ? prev.filter((pid) => pid !== p.id)
                              : [...prev, p.id!],
                          );
                      }}
                      style={[styles.projectChip, active && styles.projectChipActive]}
                    >
                      <Text style={[styles.projectLabel, active && styles.projectLabelActive]}>
                        {p.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}

          <View style={styles.cardFooter}>
            <Pressable onPress={() => setExpanded(!expanded)} hitSlop={8}>
              <Text style={styles.projectToggle}>
                {projectName} {expanded ? '▴' : '▾'}
              </Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!trimmed || busy}
              style={[styles.throwBtn, (!trimmed || busy) && styles.throwBtnDisabled]}
            >
              <Text style={styles.throwLabel}>던지기</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.lg,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 24,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono, letterSpacing: 2 },
  typeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  caret: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono, marginLeft: 2 },
  typeMenu: {
    position: 'absolute',
    top: 30,
    right: 0,
    minWidth: 108,
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingVertical: spacing.xxs,
    zIndex: 10,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  typeMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badge: { ...type.monoEyebrow, color: colors.body, fontFamily: fonts.mono },
  badgeActive: { color: colors.ink },
  textarea: {
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    minHeight: 110,
    maxHeight: 220,
    textAlignVertical: 'top',
    paddingVertical: 0,
  },
  projectScroll: { flexGrow: 0 },
  projectRow: { flexDirection: 'row', gap: spacing.xs },
  projectChip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  projectChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  projectLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  projectLabelActive: { color: colors.onInk },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
    paddingTop: spacing.sm,
  },
  projectToggle: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
  throwBtn: {
    backgroundColor: colors.ink,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  throwBtnDisabled: { opacity: 0.35 },
  throwLabel: { ...type.bodyMd, color: colors.onInk, fontFamily: fonts.sansMedium },
});
