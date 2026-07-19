import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmDelete } from '@/lib/confirm';
import { feedDateLabel, formatTime } from '@/lib/dates';
import {
  deleteFragment,
  fetchProjects,
  getFragment,
  setFragmentProjects,
  touchFragment,
  unmergeFragment,
  updateFragment,
} from '@/lib/supabase';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';
import { markFragmentUpdated } from '@/lib/fragmentUpdates';
import type { Fragment, MergedPiece, Project, Tier } from '@/lib/types';
import { useImageUrl } from '@/lib/useImageUrl';

const TIERS: { value: Tier; label: string }[] = [
  { value: 'normal', label: '보통' },
  { value: 'important', label: '중요' },
  { value: 'pinned', label: '고정' },
];

// 원탭 진입의 질문은 파편 내용을 품어야 한다 — "이거 관련 뭐 있었지"만 보내면
// 임베딩에 주제가 없어서 RAG가 아무거나 물어온다. 화면의 "이거"를 문장에 풀어 넣는다.
function rudyQuestions(fr: Fragment): { label: string; question: string }[] {
  const raw = (fr.link_title || fr.content || '').replace(/\s+/g, ' ').trim();
  const subject = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  return [
    { label: '이거 관련 뭐 있었지', question: `『${subject}』 관련해서 내가 저장해둔 게 또 뭐가 있지?` },
    { label: '이거 다음 뭐 볼까', question: `『${subject}』 다음으로 뭘 보면 좋을까?` },
  ];
}

// 화면 4: 원문 전체 + 인라인 수정 + 덧붙임 + tier 토글 + 프로젝트 + 묻기 + 삭제.
// 여는 것만으로는 touch되지 않는다 — 실질 편집(내용·덧붙임·tier·프로젝트 변경)이 있을 때만
// touch된다(SPEC §5-1의 "노출≠touch, 판단이 touch" 원칙을 파편 상세로 확장, 2026-07-19).
// 수정은 여기서 바로 한다 — 원문/이미지/링크를 보면서 고치므로 type을 덮어쓸 일이 없다.
export default function FragmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [fragment, setFragment] = useState<Fragment | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  // content/note는 인라인 편집 대상 — 로컬 상태로 들고 있다가 blur 때 저장
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [selectedPiece, setSelectedPiece] = useState<MergedPiece | null>(null);

  // 화면을 떠나는 순간(뒤로·스와이프백·하드웨어백) 바뀐 것만 저장하기 위한 최신값 스냅샷.
  // blur가 미처 못 뛴 채로 나가도 여기서 건진다 — 저장 버튼 없이 마찰 0.
  const latest = useRef({ content: '', note: '', fragment: null as Fragment | null });
  latest.current = { content, note, fragment };

  useEffect(() => {
    if (!id) return;
    fetchProjects().then(setProjects).catch(() => {});
    getFragment(id)
      .then((fr) => {
        setFragment(fr);
        setContent(fr.content);
        setNote(fr.note ?? '');
      })
      .catch(() => {});
  }, [id]);

  useEffect(
    () => () => {
      // 언마운트 = 화면 이탈. blur 저장과 겹쳐도 diff가 없으면 아무 일 없다(멱등).
      const { content: c, note: n, fragment: fr } = latest.current;
      if (!fr) return;
      if (c !== fr.content) {
        updateFragment(fr.id, { content: c })
          .then(markFragmentUpdated)
          .catch(() => {});
      }
      const nextNote = n.trim() === '' ? null : n;
      if (nextNote !== fr.note) {
        updateFragment(fr.id, { note: nextNote })
          .then(markFragmentUpdated)
          .catch(() => {});
      }
    },
    [],
  );

  if (!fragment) return <SafeAreaView style={styles.screen} />;

  async function patch(p: Partial<Omit<Fragment, 'project_ids'>>) {
    await updateFragment(fragment!.id, p);
    touchFragment(fragment!.id).catch(() => {}); // 실질 편집 = 판단 → 여기서만 touch
    markFragmentUpdated();
    setFragment({ ...fragment!, ...p });
  }

  // 원문 수정 — type은 건드리지 않는다(재판별 안 함). 안 바뀌었으면 저장도 안 한다.
  function saveContent() {
    if (content === fragment!.content) return;
    patch({ content }).catch(() => {});
  }

  // 덧붙임 저장 — 빈 문자열은 null로 (안 붙인 것과 같게)
  function saveNote() {
    const next = note.trim() === '' ? null : note;
    if (next === fragment!.note) return;
    patch({ note: next }).catch(() => {});
  }

  function openLink() {
    const raw = content.trim();
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    Linking.openURL(url).catch(() => {});
  }

  // 프로젝트는 태그 — 여러 개 동시에 붙는다 (PLAN.md §3.3)
  async function toggleProject(projectId: string | null) {
    const current = fragment!.project_ids;
    const next =
      projectId === null
        ? [] // Inbox = 매핑 전부 해제
        : current.includes(projectId)
          ? current.filter((pid) => pid !== projectId)
          : [...current, projectId];
    await setFragmentProjects(fragment!.id, next);
    touchFragment(fragment!.id).catch(() => {}); // 프로젝트 지정도 실질 편집 → touch
    markFragmentUpdated();
    setFragment({ ...fragment!, project_ids: next });
  }

  async function remove() {
    if (!(await confirmDelete())) return;
    await deleteFragment(fragment!);
    markFragmentUpdated();
    router.back();
  }

  // 펼치기 — 조각들을 원래 파편으로 되살리고 대표는 조각을 비운다
  async function unmerge() {
    await unmergeFragment(fragment!);
    markFragmentUpdated();
    setFragment({ ...fragment!, merged_from: [] });
  }

  const isLink = fragment.type === 'link';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBtn}>‹ 뒤로</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.meta}>
          {fragment.type.toUpperCase()} · {feedDateLabel(fragment.created_at)}{' '}
          {formatTime(fragment.created_at)}
        </Text>

        {fragment.image_path && <DetailImage path={fragment.image_path} />}

        {fragment.link_title && <Text style={styles.linkTitle}>{fragment.link_title}</Text>}
        {fragment.link_description && (
          <Text style={styles.linkDescription} numberOfLines={3}>
            {fragment.link_description}
          </Text>
        )}

        <TextInput
          style={[styles.content, noFocusRing]}
          multiline
          value={content}
          onChangeText={setContent}
          onEndEditing={saveContent}
          onBlur={saveContent}
          placeholder={fragment.type === 'image' ? '캡션 (선택)' : '원문…'}
          placeholderTextColor={colors.faint}
          keyboardAppearance="dark"
        />

        {isLink && (
          <Pressable onPress={openLink} style={styles.openBtn} hitSlop={8}>
            <Text style={styles.openLabel}>열기 ↗</Text>
          </Pressable>
        )}

        <Text style={styles.sectionLabel}>덧붙임</Text>
        <TextInput
          style={[styles.note, noFocusRing]}
          multiline
          value={note}
          onChangeText={setNote}
          onEndEditing={saveNote}
          onBlur={saveNote}
          placeholder="이 파편에 대한 생각을 덧붙여…"
          placeholderTextColor={colors.faint}
          keyboardAppearance="dark"
        />

        {fragment.merged_from.length > 0 && (
          <>
            <View style={styles.piecesHeader}>
              <Text style={styles.sectionLabel}>합쳐진 조각 ({fragment.merged_from.length})</Text>
              <Pressable onPress={unmerge} hitSlop={8}>
                <Text style={styles.unmergeLabel}>펼치기</Text>
              </Pressable>
            </View>
            <View style={styles.piecesList}>
              {fragment.merged_from.map((piece, i) => (
                <Pressable key={i} onPress={() => setSelectedPiece(piece)}>
                  <MergedPieceRow piece={piece} />
                </Pressable>
              ))}
            </View>
          </>
        )}

        <View style={styles.divider} />

        {/* 원탭 진입 (RUDY.md §4-C1) — 파편 하나하나가 Rudy로 들어가는 문.
            타이핑 마찰이 wow 사이의 평일 사용을 죽인다. */}
        <View style={styles.askRow}>
          {rudyQuestions(fragment).map((q) => (
            <Pressable
              key={q.label}
              onPress={() => router.push(`/chat?q=${encodeURIComponent(q.question)}`)}
              style={styles.askChip}
            >
              <Text style={styles.askLabel}>{q.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>TIER</Text>
        <View style={styles.tierRow}>
          {TIERS.map((t) => {
            const active = fragment.tier === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => patch({ tier: t.value })}
                style={[styles.tierBtn, active && styles.tierBtnActive]}
              >
                <Text style={[styles.tierLabel, active && styles.tierLabelActive]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>PROJECT</Text>
        <View style={styles.projectRow}>
          {[{ id: null as string | null, name: 'Inbox' }, ...projects].map((p) => {
            const active =
              p.id === null
                ? fragment.project_ids.length === 0
                : fragment.project_ids.includes(p.id);
            return (
              <Pressable
                key={p.id ?? 'inbox'}
                onPress={() => toggleProject(p.id)}
                style={[styles.projectChip, active && styles.projectChipActive]}
              >
                <Text style={[styles.projectLabel, active && styles.projectLabelActive]}>
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        <Pressable
          onPress={() => patch({ archived: !fragment.archived })}
          style={styles.graveBtn}
        >
          <Text style={styles.graveLabel}>
            {fragment.archived ? '파내기 — 타임라인으로 복귀' : '묻기 — 무덤으로'}
          </Text>
        </Pressable>

        <Pressable onPress={remove} style={styles.deleteBtn}>
          <Text style={styles.deleteLabel}>삭제</Text>
        </Pressable>
      </ScrollView>

      {selectedPiece && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setSelectedPiece(null)}
        >
          <SafeAreaView style={styles.screen} edges={['top']}>
            <View style={styles.header}>
              <Pressable onPress={() => setSelectedPiece(null)} hitSlop={12}>
                <Text style={styles.headerBtn}>‹ 뒤로</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.scroll}>
              <Text style={styles.meta}>
                {selectedPiece.type.toUpperCase()} · {feedDateLabel(selectedPiece.created_at)}{' '}
                {formatTime(selectedPiece.created_at)}
              </Text>
              {selectedPiece.image_path && <DetailImage path={selectedPiece.image_path} />}
              {selectedPiece.content !== '' && (
                <Text style={styles.content}>{selectedPiece.content}</Text>
              )}
              {selectedPiece.note != null && selectedPiece.note !== '' && (
                <>
                  <Text style={styles.sectionLabel}>덧붙임</Text>
                  <Text style={styles.noteReadonly}>{selectedPiece.note}</Text>
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// 합쳐진 조각 하나 — 날짜 + 원문. 이미지 조각이면 실제 이미지도 렌더한다.
function MergedPieceRow({ piece }: { piece: MergedPiece }) {
  const url = useImageUrl(piece.image_path);
  return (
    <View style={styles.pieceRow}>
      <Text style={styles.pieceDate}>
        {feedDateLabel(piece.created_at)} {formatTime(piece.created_at)}
      </Text>
      {piece.image_path && (
        <Image source={url} style={styles.pieceImage} contentFit="cover" transition={200} />
      )}
      {piece.content !== '' && (
        <Text style={styles.pieceContent} numberOfLines={4}>
          {piece.content}
        </Text>
      )}
    </View>
  );
}

// 원문 전체를 보는 화면이므로 이미지도 잘리지 않게 — 실제 비율은 로드된 뒤에야 안다
function DetailImage({ path }: { path: string }) {
  const url = useImageUrl(path);
  const [ratio, setRatio] = useState(4 / 3);
  return (
    <Image
      source={url}
      style={[styles.image, { aspectRatio: ratio }]}
      contentFit="contain"
      transition={200}
      onLoad={(e) => setRatio(e.source.width / e.source.height)}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  headerBtn: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxxl },
  meta: {
    ...type.monoEyebrow,
    color: colors.mute,
    fontFamily: fonts.mono,
    marginBottom: spacing.lg,
  },
  image: {
    width: '100%',
    borderRadius: rounded.md,
    backgroundColor: colors.hairlineSoft,
    marginBottom: spacing.md,
  },
  content: {
    ...type.bodyLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    padding: 0,
    textAlignVertical: 'top',
  },
  linkTitle: {
    ...type.bodyMd,
    color: colors.body,
    fontFamily: fonts.sansMedium,
    marginBottom: spacing.sm,
  },
  linkDescription: {
    ...type.bodySm,
    color: colors.mute,
    fontFamily: fonts.sans,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  openBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  openLabel: { ...type.bodyMd, color: colors.link, fontFamily: fonts.sansMedium },
  note: {
    ...type.bodyMd,
    color: colors.body,
    fontFamily: fonts.sans,
    padding: 0,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  noteReadonly: {
    ...type.bodyMd,
    color: colors.body,
    fontFamily: fonts.sans,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.xl,
  },
  piecesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unmergeLabel: { ...type.bodyMd, color: colors.link, fontFamily: fonts.sansMedium },
  piecesList: { gap: spacing.md },
  pieceRow: {
    borderLeftWidth: 2,
    borderLeftColor: colors.hairline,
    paddingLeft: spacing.sm,
    gap: spacing.xs,
  },
  pieceDate: {
    ...type.monoEyebrow,
    color: colors.faint,
    fontFamily: fonts.mono,
  },
  pieceImage: {
    width: '100%',
    height: 160,
    borderRadius: rounded.sm,
    backgroundColor: colors.hairlineSoft,
  },
  pieceContent: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  sectionLabel: {
    ...type.monoEyebrow,
    color: colors.faint,
    fontFamily: fonts.mono,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  tierRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.lg },
  tierBtn: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tierBtnActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  tierLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  tierLabelActive: { color: colors.onInk },
  projectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
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
  askRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  askChip: {
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  askLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  graveBtn: { paddingVertical: spacing.sm },
  graveLabel: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sansMedium },
  deleteBtn: { paddingVertical: spacing.sm, marginTop: spacing.sm },
  deleteLabel: { ...type.bodyMd, color: colors.error, fontFamily: fonts.sansMedium },
});
