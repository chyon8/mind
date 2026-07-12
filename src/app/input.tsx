import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  fetchProjects,
  getFragment,
  insertFragment,
  setFragmentProjects,
  updateFragment,
} from '@/lib/supabase';
import { colors, fonts, rounded, spacing, type } from '@/lib/theme';
import { markThrown } from '@/lib/thrown';
import { detectType } from '@/lib/typeDetector';
import type { Project } from '@/lib/types';

// 타입별 글로우 색 — 링크는 블루, 인용은 잉크 톤. 은은하게.
const GLOW_COLOR: Record<string, string> = {
  link: colors.link,
  quote: colors.ink,
};

// 화면 3: 붙여넣기/타이핑 → 타입 자동 인식(글로우) → 던지기.
// ?id= 가 있으면 수정 모드. 프로젝트 선택은 접힌 옵션, 기본 Inbox (SPEC §6-3).
export default function Input() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [text, setText] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;

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
  const glowColor = GLOW_COLOR[detected];
  const projectName =
    projectIds.length === 0
      ? 'Inbox'
      : projects
          .filter((p) => projectIds.includes(p.id))
          .map((p) => p.name)
          .join(', ') || 'Inbox';

  // 타입이 인식되는 순간 입력창 주위가 은은하게 빛난다
  useEffect(() => {
    Animated.timing(glow, {
      toValue: glowColor ? 1 : 0,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [glowColor != null]);

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
      router.back();
    } catch {
      // 실패 시 원문 보존 + 수동 재시도 (확정 결정 2)
      Alert.alert('던지지 못했다', '네트워크를 확인하고 다시 시도해줘.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>닫기</Text>
        </Pressable>
        {trimmed !== '' && (
          <Text style={[styles.badge, glowColor != null && { color: glowColor }]}>
            {detected.toUpperCase()}
          </Text>
        )}
      </View>

      <Animated.View
        style={[
          styles.inputWell,
          {
            borderColor: glow.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.hairline, glowColor ?? colors.hairline],
            }),
            shadowColor: glowColor ?? colors.hairline,
            shadowOpacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }),
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      >
        <TextInput
          style={styles.textarea}
          multiline
          autoFocus
          value={text}
          onChangeText={setText}
          placeholder="파편을 던져…"
          placeholderTextColor={colors.faint}
          keyboardAppearance="dark"
        />
      </Animated.View>

      <View style={styles.bottom}>
        <Pressable onPress={() => setExpanded(!expanded)} hitSlop={8}>
          <Text style={styles.projectToggle}>
            {projectName} {expanded ? '▴' : '▾'}
          </Text>
        </Pressable>
        {expanded && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
        <Pressable
          onPress={submit}
          disabled={!trimmed || busy}
          style={[styles.throwBtn, (!trimmed || busy) && styles.throwBtnDisabled]}
        >
          <Text style={styles.throwLabel}>{id ? '수정' : '던지기'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvasElevated },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  cancel: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
  badge: { ...type.monoEyebrow, color: colors.body, fontFamily: fonts.mono },
  inputWell: {
    flex: 1,
    marginHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: rounded.lg,
    backgroundColor: colors.canvasElevated,
  },
  textarea: {
    flex: 1,
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  bottom: { padding: spacing.md, gap: spacing.sm },
  projectToggle: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sans },
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
  throwBtn: {
    backgroundColor: colors.ink,
    borderRadius: rounded.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  throwBtnDisabled: { opacity: 0.35 },
  throwLabel: { ...type.bodyLg, color: colors.onInk, fontFamily: fonts.sansMedium },
});
