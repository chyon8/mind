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
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  fetchProjects,
  getFragment,
  insertFragment,
  setFragmentProjects,
  updateFragment,
} from '@/lib/supabase';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';
import { markThrown } from '@/lib/thrown';
import { detectType } from '@/lib/typeDetector';
import type { Project } from '@/lib/types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// 타입 배지 색 — 링크는 블루, 인용은 잉크 톤. 텍스트에만, 테두리엔 쓰지 않는다.
const BADGE_COLOR: Record<string, string> = {
  link: colors.link,
  quote: colors.ink,
};

// 화면 3: 붙여넣기/타이핑 → 타입 자동 인식(배지) → 던지기.
// transparentModal 위에 떠 있는 가운데 카드. 열릴 때 스프링으로 떠오르고,
// 던지기 성공 시 카드가 위로 날아가며 사라진다.
// ?id= 가 있으면 수정 모드. 프로젝트 선택은 접힌 옵션, 기본 Inbox (SPEC §6-3).
export default function Input() {
  // draft = 공유 저장이 실패했을 때 넘어온 원문 (확정 결정 2)
  const { id, draft } = useLocalSearchParams<{ id?: string; draft?: string }>();
  const [text, setText] = useState(draft ?? '');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
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
    if (id) {
      getFragment(id)
        .then((fr) => {
          setText(fr.content);
          setProjectIds(fr.project_ids);
        })
        .catch(() => {});
    }
  }, [id]);

  const trimmed = text.trim();
  const detected = detectType(trimmed);
  // text는 기본값이라 배지를 띄우지 않는다 — 인식되는 순간만 특별하게
  const hint = detected === 'text' ? null : detected;
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
    progress.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(goBack);
    });
  }

  async function submit() {
    if (!trimmed || busy) return; // 빈 입력·중복 탭 방지
    setBusy(true);
    try {
      if (id) {
        await updateFragment(id, { content: trimmed, type: detected });
        await setFragmentProjects(id, projectIds);
      } else {
        await insertFragment({ content: trimmed, type: detected, project_ids: projectIds });
        markThrown(); // 데일리 뷰가 오늘로 이동하도록 (PLAN §6.1)
      }
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
            <Text style={styles.eyebrow}>{id ? '수정' : '새 파편'}</Text>
            {hint != null && (
              <Animated.View
                key={hint}
                entering={ZoomIn.springify().damping(14).stiffness(240)}
                exiting={FadeOut.duration(100)}
                style={styles.badgePill}
              >
                <View style={[styles.badgeDot, { backgroundColor: BADGE_COLOR[hint] }]} />
                <Text style={styles.badge}>{hint.toUpperCase()}</Text>
              </Animated.View>
            )}
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectScroll}>
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
              <Text style={styles.throwLabel}>{id ? '수정' : '던지기'}</Text>
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
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badge: { ...type.monoEyebrow, color: colors.body, fontFamily: fonts.mono },
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
