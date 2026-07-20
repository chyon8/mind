// Rudy 답변용 미니 마크다운 (RUDY.md §10-5).
//
// 라이브러리를 안 쓴 이유: RN 마크다운 렌더러들은 React 19/RN 0.81 peer 충돌 위험이 있고,
// 프롬프트가 문법을 우리가 정한 부분집합(굵게·목록·링크·코드)으로 제한하므로
// 그만큼만 정확히 그리는 게 낫다. 파서는 순수 함수 — jest로 못 박는다.
//
// 링크는 mind:// 스킴을 이해하는 쪽(chat.tsx)이 onLink로 라우팅한다.
// 스트리밍 중 미완성 텍스트(안 닫힌 **, 안 닫힌 펜스)에도 죽지 않아야 한다.
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, rounded, spacing, type } from './theme';

export type Inline =
  | { t: 'text' | 'code'; text: string }
  // 굵게는 **안에 다른 마크업을 품을 수 있다** — 모델이 링크를 굵게 감싸는 걸 막을 방법이 없다
  | { t: 'bold'; inline: Inline[] }
  | { t: 'link'; text: string; href: string };

export type Block =
  | { t: 'p' | 'h'; inline: Inline[] }
  | { t: 'li'; ordered: boolean; index: number; inline: Inline[] }
  | { t: 'codeblock'; text: string };

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: 'text', text: src.slice(last, m.index) });
    // ⚠️ 굵게 안을 다시 파싱한다. `**[제목](mind://…)**`에서 `[^*]+`가 링크 마크업을 통째로
    // 삼켜서 **마크업 원문이 화면에 그대로 찍히고 탭도 안 됐다** (2026-07-20).
    // 프롬프트로 "링크를 굵게 감싸지 마라"고 막는 건 모델 취향에 기대는 것 — 파서가 견뎌야 한다.
    if (m[1] != null) out.push({ t: 'bold', inline: parseInline(m[1]) });
    else if (m[2] != null) out.push({ t: 'code', text: m[2] });
    else out.push({ t: 'link', text: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', text: src.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let code: string[] | null = null;

  const flush = () => {
    if (para.length) blocks.push({ t: 'p', inline: parseInline(para.join('\n')) });
    para = [];
  };

  for (const line of src.split('\n')) {
    if (code) {
      if (line.startsWith('```')) {
        blocks.push({ t: 'codeblock', text: code.join('\n') });
        code = null;
      } else code.push(line);
      continue;
    }
    if (line.startsWith('```')) {
      flush();
      code = [];
      continue;
    }
    const h = line.match(/^#{1,6}\s+(.*)/);
    // 불릿 마커 뒤엔 공백 필수 — "**굵게**로 시작하는 줄"이 목록으로 오인되지 않게
    const b = line.match(/^\s*[-*•]\s+(.*)/);
    const o = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    if (h) {
      flush();
      blocks.push({ t: 'h', inline: parseInline(h[1]) });
    } else if (b) {
      flush();
      blocks.push({ t: 'li', ordered: false, index: 0, inline: parseInline(b[1]) });
    } else if (o) {
      flush();
      blocks.push({ t: 'li', ordered: true, index: +o[1], inline: parseInline(o[2]) });
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line);
    }
  }
  if (code) blocks.push({ t: 'codeblock', text: code.join('\n') }); // 스트리밍 중 안 닫힌 펜스
  flush();
  return blocks;
}

function InlineRun({ inline, onLink }: { inline: Inline[]; onLink?: (href: string) => void }) {
  return (
    <>
      {inline.map((seg, i) => {
        if (seg.t === 'bold')
          return (
            <Text key={i} style={styles.bold}>
              <InlineRun inline={seg.inline} onLink={onLink} />
            </Text>
          );
        if (seg.t === 'code')
          return (
            <Text key={i} style={styles.inlineCode}>
              {seg.text}
            </Text>
          );
        if (seg.t === 'link')
          return (
            <Text key={i} style={styles.link} onPress={onLink && (() => onLink(seg.href))}>
              {seg.text}
            </Text>
          );
        return <Text key={i}>{seg.text}</Text>;
      })}
    </>
  );
}

export function Markdown({ text, onLink }: { text: string; onLink?: (href: string) => void }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={styles.root}>
      {blocks.map((b, i) => {
        if (b.t === 'codeblock')
          return (
            <View key={i} style={styles.codeBlock}>
              <Text style={styles.codeText}>{b.text}</Text>
            </View>
          );
        if (b.t === 'li')
          return (
            <View key={i} style={styles.liRow}>
              <Text style={styles.liMarker}>{b.ordered ? `${b.index}.` : '·'}</Text>
              <Text style={styles.body}>
                <InlineRun inline={b.inline} onLink={onLink} />
              </Text>
            </View>
          );
        return (
          <Text key={i} style={b.t === 'h' ? styles.heading : styles.body}>
            <InlineRun inline={b.inline} onLink={onLink} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  body: { ...type.bodyLg, color: colors.ink, fontFamily: fonts.sans, flex: 1 },
  heading: { ...type.headingMd, color: colors.ink, fontFamily: fonts.sansSemiBold },
  bold: { fontFamily: fonts.sansSemiBold },
  link: { color: colors.link, textDecorationLine: 'underline' },
  inlineCode: { fontFamily: fonts.mono, ...type.bodyMd, color: colors.body },
  liRow: { flexDirection: 'row', gap: spacing.xs, paddingLeft: spacing.xxs },
  liMarker: { ...type.bodyLg, color: colors.mute, fontFamily: fonts.sans },
  codeBlock: {
    backgroundColor: colors.canvasElevated,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: rounded.sm,
    padding: spacing.sm,
  },
  codeText: { ...type.bodySm, color: colors.body, fontFamily: fonts.mono },
});
