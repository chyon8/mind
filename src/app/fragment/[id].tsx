import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmDelete } from '@/lib/confirm';
import { feedDateLabel, formatTime } from '@/lib/dates';
import { Markdown } from '@/lib/markdown';
import {
  countDiscoverNext,
  deleteFragment,
  fetchProjects,
  fetchSimilarFragments,
  getFragment,
  rememberFragment,
  setFragmentProjects,
  touchFragment,
  unmergeFragment,
  updateFragment,
} from '@/lib/supabase';
import { vividness } from '@/lib/vividness';
import { colors, fonts, noFocusRing, rounded, spacing, type } from '@/lib/theme';
import { markFragmentUpdated } from '@/lib/fragmentUpdates';
import type { Fragment, MergedPiece, Project, Tier } from '@/lib/types';
import { useImageUrl } from '@/lib/useImageUrl';

const TIERS: { value: Tier; label: string }[] = [
  { value: 'normal', label: '보통' },
  { value: 'important', label: '중요' },
  { value: 'pinned', label: '고정' },
];

// "다음 발견에 포함" 동시 표시 상한. 다 지정해버리면 브리핑이 통째로 지시 이행이 되고
// "안 물어본 걸 물어온다"는 발견의 본질이 죽는다 (2026-07-25 유저 지시).
const DISCOVER_MAX = 5;

// 칩이 보내는 문장은 파편 내용을 품어야 한다 — "같은 종류로 뭐 있을까"만 보내면
// 서버가 무엇의 종류인지 모른다. 화면의 "이거"를 문장에 풀어 넣는다.
function subjectOf(fr: Fragment): string {
  const raw = (fr.link_title || fr.content || '').replace(/\s+/g, ' ').trim();
  return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
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
  // 덧붙임 안 링크를 누르려면 읽기 모드(Markdown)여야 한다 — 편집 중엔 TextInput이라 못 누른다.
  // 내용이 있으면 기본은 읽기 모드, 탭하면 편집으로 전환.
  const [noteEditing, setNoteEditing] = useState(false);
  const [selectedPiece, setSelectedPiece] = useState<MergedPiece | null>(null);
  // "이거 관련 뭐 있었지" — 이 화면 안에서 펼쳐지는 안쪽 목록. null = 아직 안 눌렀다.
  const [similar, setSimilar] = useState<Fragment[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  // 표시가 5개 꽉 찼을 때 잠깐 뜨는 안내 (토스트를 새로 들이지 않는다 — 그 자리 글자로만 말한다)
  const [discoverFull, setDiscoverFull] = useState(false);

  // 화면을 떠나는 순간(뒤로·스와이프백·하드웨어백) 바뀐 것만 저장하기 위한 최신값 스냅샷.
  // blur가 미처 못 뛴 채로 나가도 여기서 건진다 — 저장 버튼 없이 마찰 0.
  const latest = useRef({ content: '', note: '', fragment: null as Fragment | null });
  latest.current = { content, note, fragment };

  useEffect(() => {
    if (!discoverFull) return;
    const t = setTimeout(() => setDiscoverFull(false), 1600);
    return () => clearTimeout(t);
  }, [discoverFull]);

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

  // 고정한 걸 실수로 묻지 않게 — 묻으려면 먼저 고정을 풀어야 한다 (파내기는 그대로 허용)
  const pinnedBlocksGrave = fragment.tier === 'pinned' && !fragment.archived;

  // touch는 **내용에 손댔을 때만** 한다 (2026-07-22). 예전엔 tier·프로젝트 변경도 touch였는데,
  // 인박스를 정리하다가 54개 시계가 한꺼번에 리셋됐다 — 파일링은 "이게 아직 중요해"라는
  // 판단이 아니다. tier는 그 자체로 감쇠 속도를 바꾸므로 touch까지 하면 중복이기도 하다.
  async function patch(p: Partial<Omit<Fragment, 'project_ids'>>, touch = false) {
    await updateFragment(fragment!.id, p);
    if (touch) touchFragment(fragment!.id).catch(() => {});
    markFragmentUpdated();
    setFragment({ ...fragment!, ...p });
  }

  // 원문 수정 — type은 건드리지 않는다(재판별 안 함). 안 바뀌었으면 저장도 안 한다.
  function saveContent() {
    if (content === fragment!.content) return;
    patch({ content }, true).catch(() => {}); // 내용을 고쳤다 = 다시 들여다봤다
  }

  // 덧붙임 저장 — 빈 문자열은 null로 (안 붙인 것과 같게)
  function saveNote() {
    const next = note.trim() === '' ? null : note;
    if (next === fragment!.note) return;
    patch({ note: next }, true).catch(() => {});
  }

  // 살리기 (2026-07-22) — 흐려지는 걸 멈추는 유일한 명시 행동.
  // 열어보는 것만으로는 아무 일도 안 일어난다("그냥 봤다고 선명해지면 안 된다").
  // 회상의 `기억하기`와 같은 처리 = 100% 복귀 + 중요도 한 칸.
  async function revive() {
    await rememberFragment(fragment!);
    markFragmentUpdated();
    setFragment({
      ...fragment!,
      last_touched_at: new Date().toISOString(),
      touch_count: fragment!.touch_count + 1,
    });
  }

  function openLink() {
    const raw = content.trim();
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    Linking.openURL(url).catch(() => {});
  }

  // 덧붙임 안 링크 — 던지기로 들어온 마크다운 링크든 유저가 직접 쓴 URL이든 눌러서 열 수 있어야 한다
  function openUrl(href: string) {
    Linking.openURL(href).catch(() => {});
  }

  // "다음 발견에 포함" (RUDY-STATUS.md ①) — 다음 브리핑이 이 파편을 반드시 각도로 만든다.
  // 브리핑이 한 번 돌면 서버가 전부 내린다(brief.ts) — 한 번 나오고 끝, 또 원하면 또 누른다.
  // touch 안 한다(patch 기본값) — 표시는 "이걸 봐줘"라는 지시지 "아직 중요해"라는 판단이 아니다.
  //
  // 슬롯을 같이 받는다 (2026-08-03). 지정 파편은 재료 맨 위에 통째로 박히니 모델이 소재를
  // 따라가 거의 매번 [확장]으로 착지했다 — 누를 때 유저가 이미 아는 걸 버리고 모델에게
  // 다시 추측시키던 자리다. 판정을 시키지 않고 유저가 고른 값을 그대로 재료에 싣는다.
  async function toggleDiscoverNext(slot: 'expansion' | 'idea') {
    // 같은 걸 또 누르면 끈다. 다른 걸 누르면 슬롯만 갈아끼운다(개수가 안 느니 캡도 안 센다).
    if (fragment!.discover_next && (fragment!.discover_next_slot ?? 'expansion') === slot) {
      await patch({ discover_next: false, discover_next_slot: null });
      return;
    }
    // 상한 5개 — 다 지정하면 브리핑이 통째로 지시 이행이 되고 발견이 죽는다
    if (!fragment!.discover_next && (await countDiscoverNext()) >= DISCOVER_MAX) {
      setDiscoverFull(true);
      return;
    }
    // 포함과 제외는 같이 켜질 수 없다 — 서로를 끈다
    await patch({ discover_next: true, discover_next_slot: slot, discover_skip: false });
  }

  // "발견에서 제외" — 포함의 대칭. 브리핑 재료에서 이 파편이 빠진다(material.ts).
  // ⚠️ 발견에만 건다. 채팅·검색은 그대로 다 본다 — "여행 뭐 저장했지"엔 답할 수 있어야 한다.
  // touch 안 한다(patch 기본값) — 이것도 "이건 보지 마"라는 지시지 중요도 판단이 아니다.
  async function toggleDiscoverSkip() {
    await patch(
      fragment!.discover_skip
        ? { discover_skip: false }
        : { discover_skip: true, discover_next: false, discover_next_slot: null },
    );
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
    touchFragment(fragment!.id).catch(() => {}); // 프로젝트 지정 = 지금 그걸 다시 붙잡은 것 (2026-07-22 유저 확정)
    markFragmentUpdated();
    setFragment({ ...fragment!, project_ids: next });
  }

  // "이거 관련 뭐 있었지" — 채팅으로 나가지 않고 여기서 편다. 임베딩만 쓰므로 공짜다.
  // 다시 누르면 접힌다. 접었다 펴도 다시 안 가져온다 — 그 사이 바뀔 게 없다.
  function toggleSimilar() {
    if (similar) {
      setSimilar(null);
      return;
    }
    setSimilarLoading(true);
    fetchSimilarFragments(fragment!.id)
      .then(setSimilar)
      .catch(() => setSimilar([])) // 실패도 "없다"로 보여준다 — 빈 화면보단 낫다
      .finally(() => setSimilarLoading(false));
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
  // 링크 메타(제목)는 저장 뒤에 따로 붙는다 — 그 전엔 바깥으로 나갈 재료가 없다
  const titlePending = isLink && !fragment.link_title;
  // 지금 켜진 슬롯. 슬롯 버튼 이전에 지정한 것(null)은 여태 사실상 [확장]으로 나갔으니 그렇게 보인다.
  const pickedSlot = fragment.discover_next ? (fragment.discover_next_slot ?? 'expansion') : null;

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

        {/* 바깥에서 온 층 — 제목이 헤드라인이다. 목록 카드(FragmentCard)와 같은 위계를 쓴다:
            거기선 제목이 bodyLg/ink이고 URL이 각주인데 여기만 반대였다(2026-08-09).
            썸네일도 카드와 같은 크기로 곁에 둔다 — og:image는 1200×630 배너가 대부분이라
            크게 펴면 읽을 것과 조작할 것을 화면 밖으로 밀어내고, 썸네일 없는 파편과
            화면 구조가 달라 보인다. "뭐였지"를 알아보는 데는 이 크기로 충분하다. */}
        {(fragment.link_title || fragment.link_thumbnail_url?.startsWith('http')) && (
          <View style={styles.linkHead}>
            {fragment.link_title && (
              <Text style={[styles.linkTitle, styles.linkHeadText]}>{fragment.link_title}</Text>
            )}
            {fragment.link_thumbnail_url?.startsWith('http') && (
              <Image
                source={fragment.link_thumbnail_url}
                style={styles.linkThumb}
                contentFit="cover"
                transition={200}
              />
            )}
          </View>
        )}
        {fragment.link_description && <LinkBody text={fragment.link_description} />}

        <TextInput
          // 링크의 content는 URL이라 읽을 게 없다 — 주인공 자리를 제목에 내주고 각주로 내려간다.
          // 편집은 그대로 가능하다(원문 수정은 SPEC §6-4).
          style={[styles.content, isLink && styles.contentUrl, noFocusRing]}
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
        {noteEditing || !note ? (
          <TextInput
            style={[styles.note, noFocusRing]}
            multiline
            autoFocus={noteEditing}
            value={note}
            // 빈 덧붙임에 바로 탭해 들어온 경우 noteEditing이 false다 — 첫 글자를 치는 순간
            // note가 채워져 이 분기(`!note`)가 깨지고 TextInput이 통째로 사라졌다(키보드 꺼짐).
            // 포커스 자체를 편집 시작으로 본다.
            onFocus={() => setNoteEditing(true)}
            onChangeText={setNote}
            onEndEditing={saveNote}
            onBlur={() => {
              saveNote();
              setNoteEditing(false);
            }}
            placeholder="이 파편에 대한 생각을 덧붙여…"
            placeholderTextColor={colors.faint}
            keyboardAppearance="dark"
          />
        ) : (
          <Pressable onPress={() => setNoteEditing(true)}>
            <Markdown text={note} onLink={openUrl} />
          </Pressable>
        )}

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

        {/* 살리기 — 이미 선명한 것엔 안 뜬다. AI 칩(원탭 진입)과 다른 종류의 행동이라
            구간을 나눈다 — 이건 루디에게 묻는 게 아니라 선명도 자체를 되돌리는 것. */}
        {vividness(fragment) < 1 && (
          <>
            <View style={styles.divider} />
            <Pressable onPress={() => revive().catch(() => {})} style={styles.reviveBtn}>
              <Text style={styles.reviveLabel}>기억하기</Text>
            </Pressable>
          </>
        )}

        <View style={styles.divider} />

        {/* 원탭 진입 (RUDY.md §4-C1) — 파편 하나하나가 Rudy로 들어가는 문.
            타이핑 마찰이 wow 사이의 평일 사용을 죽인다.
            셋의 역할이 겹치지 않게 갈랐다: **안쪽 / 자유 / 바깥.** */}
        <View style={styles.askRow}>
          <Pressable onPress={toggleSimilar} style={styles.askChip}>
            <Text style={styles.askLabel}>이거 관련 뭐 있었지</Text>
          </Pressable>
          {/* 물고만 들어간다 — 자동 전송 없음. 뭘 물을지는 거기서 정한다. */}
          <Pressable
            onPress={() => router.push(`/chat?fid=${fragment.id}`)}
            style={styles.askChip}
          >
            <Text style={styles.askLabel}>채팅하기</Text>
          </Pressable>
          {/* 바깥. 소재의 이름이 아니라 **종류**로 찾는다 — 그 분기는 서버가 mode로 받는다.
              종류를 뽑는 재료는 이 문장이 아니라 **파편 원본**이다 — fid로 물려 보낸다.
              제목 한 줄만 보내던 때는 유튜브 제목의 "cinematic"만 보고 플러그인 쇼핑몰을
              물어왔다(2026-08-02 로그). 설명·덧붙임에 "이펙터 페달"이 적혀 있었는데도.
              문장은 전송하지 않고 입력창에 채워만 둔다 — 고치고 보낼 수 있어야 한다. */}
          <Pressable
            onPress={() =>
              router.push(
                `/chat?fid=${fragment.id}&mode=more_like&draft=${encodeURIComponent(
                  `『${subjectOf(fragment)}』 같은 종류로 바깥에 뭐가 또 있을까?`,
                )}`,
              )
            }
            disabled={titlePending}
            style={[styles.askChip, titlePending && styles.askChipOff]}
          >
            <Text style={[styles.askLabel, titlePending && styles.askLabelOff]}>more like this</Text>
          </Pressable>
        </View>

        {/* 링크 제목이 아직 안 붙은 채로 나가면 남는 재료가 퍼센트 인코딩된 URL뿐이라
            종류를 못 뽑는다 — 실제로 앱 차단 앱을 "퍼즐 게임"으로 읽고 애니팡을 물어왔다. */}
        {titlePending && (
          <Text style={styles.similarEmpty}>링크 제목을 아직 못 가져왔다 — 잠시 뒤 다시 열면 바깥으로 나갈 수 있다</Text>
        )}

        {/* 안쪽 목록 — 열면 touch되지 않는다(이 화면 자체가 그렇다). 무덤도 나온다. */}
        {similarLoading && <Text style={styles.similarEmpty}>찾는 중…</Text>}
        {similar && !similarLoading && (
          <View style={styles.similarList}>
            {similar.length === 0 ? (
              <Text style={styles.similarEmpty}>
                닿는 게 아직 없다 — 방금 저장한 파편이면 잠시 뒤 다시 눌러봐라
              </Text>
            ) : (
              similar.map((s) => (
                <Pressable key={s.id} onPress={() => router.push(`/fragment/${s.id}`)}>
                  <Text style={styles.similarDate}>
                    {feedDateLabel(s.created_at)}
                    {s.archived ? ' · 무덤' : ''}
                  </Text>
                  <Text style={styles.similarText} numberOfLines={2}>
                    {(s.link_title || s.content || '').replace(/\s+/g, ' ').trim()}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        )}

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

        {/* 발견 (RUDY-STATUS.md ①) — 루디에게 주는 지시다. 위 루디 칩(묻기=읽기, 채팅으로 이동)과
            섞이면 안 되므로 TIER·PROJECT와 같은 층(이 파편의 속성을 정하는 자리)에 둔다.
            ⚠️ 라벨은 상태에 따라 **바꾸지 않는다** — 폭이 튄다. 켜짐은 채움으로만 말한다
            (projectChipActive와 같은 관용구). 안내·경고도 버튼이 아니라 아래 한 줄이 받는다. */}
        <Text style={styles.sectionLabel}>발견</Text>
        {/* 포함/제외는 서로 배타적이라 한 줄에 나란히 둔다 — 셋 중 하나만 채워진다.
            포함이 둘로 갈린 건 슬롯 때문이다 — 어느 걸 눌렀냐가 곧 [확장]이냐 [아이디어]냐다. */}
        <View style={styles.discoverRow}>
          <Pressable
            onPress={() => toggleDiscoverNext('expansion').catch(() => {})}
            style={[styles.discoverBtn, pickedSlot === 'expansion' && styles.discoverBtnOn]}
          >
            <Text style={[styles.discoverLabel, pickedSlot === 'expansion' && styles.discoverLabelOn]}>
              더 파줘
            </Text>
          </Pressable>
          <Pressable
            onPress={() => toggleDiscoverNext('idea').catch(() => {})}
            style={[styles.discoverBtn, pickedSlot === 'idea' && styles.discoverBtnOn]}
          >
            <Text style={[styles.discoverLabel, pickedSlot === 'idea' && styles.discoverLabelOn]}>
              비슷한 딴 거
            </Text>
          </Pressable>
          <Pressable
            onPress={() => toggleDiscoverSkip().catch(() => {})}
            style={[styles.discoverBtn, fragment.discover_skip && styles.discoverBtnOn]}
          >
            <Text style={[styles.discoverLabel, fragment.discover_skip && styles.discoverLabelOn]}>
              발견에서 제외
            </Text>
          </Pressable>
        </View>
        <Text style={styles.discoverHint}>
          {discoverFull
            ? `최대 ${DISCOVER_MAX}개까지 지정할 수 있다`
            : fragment.discover_skip
              ? '브리핑 재료에서 빠진다 — 검색·채팅에는 그대로 나온다'
              : pickedSlot === 'expansion'
                ? '이 소재가 가리키는 방향을 더 판다 — 한 번 나오고 자동으로 꺼진다'
                : pickedSlot === 'idea'
                  ? '소재는 끊고 같은 동기를 채우는 딴 물건을 찾는다 — 한 번 나오고 자동으로 꺼진다'
                  : '더 파줘 = 이 소재를 더 / 비슷한 딴 거 = 소재는 끊고 같은 동기의 다른 물건'}
        </Text>

        <View style={styles.divider} />

        <Pressable
          onPress={() => {
            if (pinnedBlocksGrave) return;
            patch({ archived: !fragment.archived });
          }}
          style={[styles.graveBtn, pinnedBlocksGrave && styles.graveBtnDisabled]}
        >
          <Text style={styles.graveLabel}>
            {fragment.archived
              ? '파내기 — 타임라인으로 복귀'
              : pinnedBlocksGrave
                ? '묻기 — 고정을 먼저 풀어야 한다'
                : '묻기 — 무덤으로'}
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
                  <Markdown text={selectedPiece.note} onLink={openUrl} />
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// 링크 본문(og:description 또는 레딧 selftext). 예전엔 numberOfLines={3} 하드컷이라
// 긴 본문이 통째로 잘린 채 펼 방법이 없었다 — 접고 펼 수 있게 한다.
const COLLAPSED_LINES = 6;
// 이 길이를 넘으면 6줄에 안 들어간다고 보고 토글을 붙인다. 렌더 후 줄 수를 재는 방법
// (onTextLayout)은 numberOfLines가 걸린 상태에선 잘린 줄 수만 돌려줘서 못 쓴다.
// 빗나가도 손해가 없는 쪽으로 넉넉히 잡았다 — 안 잘렸는데 "더 보기"가 뜨는 정도.
const COLLAPSE_THRESHOLD = 220;

function LinkBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.length > COLLAPSE_THRESHOLD;
  return (
    <View style={styles.linkBodyWrap}>
      <Text style={styles.linkDescription} numberOfLines={expanded ? undefined : COLLAPSED_LINES}>
        {text}
      </Text>
      {collapsible && (
        <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
          <Text style={styles.linkMore}>{expanded ? '접기' : '더 보기'}</Text>
        </Pressable>
      )}
    </View>
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
  // 원문·덧붙임은 이 화면에서 실제로 **읽는** 자리다 — 읽기 행간을 쓴다(type.readingLg/Md).
  content: {
    ...type.readingLg,
    color: colors.ink,
    fontFamily: fonts.sans,
    padding: 0,
    textAlignVertical: 'top',
  },
  linkHead: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  linkHeadText: { flex: 1 },
  linkThumb: {
    width: 64,
    height: 64,
    borderRadius: rounded.sm,
    backgroundColor: colors.hairlineSoft,
  },
  // 헤드라인 — 목록 카드의 linkTitle과 같은 토큰(bodyLg/ink/Medium). 상세가 목록보다
  // 제목을 작게 보여줄 이유가 없다.
  linkTitle: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sansMedium },
  linkBodyWrap: { gap: spacing.xxs, marginBottom: spacing.md },
  // 본문은 읽으라고 있는 것 — 캡션(bodySm/mute)이 아니라 읽는 행간으로 둔다
  linkDescription: { ...type.readingMd, color: colors.body, fontFamily: fonts.sans },
  linkMore: { ...type.bodySm, color: colors.link, fontFamily: fonts.sansMedium },
  // 링크의 URL — 목록 카드의 linkUrl과 같은 각주 취급
  contentUrl: { ...type.bodySm, color: colors.mute },
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
    ...type.readingMd,
    color: colors.body,
    fontFamily: fonts.sans,
    padding: 0,
    minHeight: 88, // 한 줄(44)은 쓰기 시작할 자리로도 답답했다 — 두 줄치를 비워둔다
    textAlignVertical: 'top',
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
  askChipOff: { borderColor: colors.faint, opacity: 0.5 },
  askLabelOff: { color: colors.faint },
  // 안쪽 유사 파편 — 날짜 + 본문 두 줄. 카드로 만들지 않는다(여긴 목록이 아니라 각주다).
  similarList: { gap: spacing.md, marginTop: spacing.md },
  similarDate: { ...type.monoEyebrow, color: colors.faint, fontFamily: fonts.mono },
  similarText: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sans },
  similarEmpty: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans, marginTop: spacing.sm },
  // 살리기는 칩들과 같은 결이되 혼자 있는 행동이라 한 줄을 차지한다
  reviveBtn: {
    alignSelf: 'flex-start',
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    marginBottom: spacing.sm,
  },
  reviveLabel: { ...type.bodyMd, color: colors.ink, fontFamily: fonts.sansMedium },
  // 발견 표시 — tier 토글과 같은 모양(rounded.sm·같은 패딩). 라벨은 안 바뀌므로 폭이 고정이고,
  // 켜짐은 채움으로만 말한다. 상태 문구는 아래 hint 한 줄이 받는다 (버튼을 토스트로 쓰지 않는다).
  discoverRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  discoverBtn: {
    alignSelf: 'flex-start',
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: rounded.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  discoverBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  discoverLabel: { ...type.bodyMd, color: colors.body, fontFamily: fonts.sansMedium },
  discoverLabelOn: { color: colors.onInk },
  // 한 줄 안내 — 상태·경고가 여기로 온다. 버튼 폭에 영향을 주지 않는 자리다.
  discoverHint: { ...type.bodySm, color: colors.faint, fontFamily: fonts.sans, marginTop: spacing.xs },
  graveBtn: { paddingVertical: spacing.sm },
  graveBtnDisabled: { opacity: 0.4 },
  graveLabel: { ...type.bodyMd, color: colors.mute, fontFamily: fonts.sansMedium },
  deleteBtn: { paddingVertical: spacing.sm, marginTop: spacing.sm },
  deleteLabel: { ...type.bodyMd, color: colors.error, fontFamily: fonts.sansMedium },
});
