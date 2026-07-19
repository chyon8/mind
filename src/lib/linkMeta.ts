// PLAN.md §3.6 — 저장은 즉시, 메타데이터는 나중에.
// RN의 fetch는 CORS 제약이 없어 브라우저와 달리 HTML을 직접 받아 파싱할 수 있다.
// 실패한 것은 그냥 둔다 — URL 원문이 이미 있으므로 기능 손실이 없다. 재시도 카운터 없음.

import { fetchLinksMissingMeta, updateFragment } from './supabase';

const BATCH = 10; // 포그라운드 진입 1회당 처리할 파편 수 (PLAN §3.6)
const TIMEOUT_MS = 8000;

function meta(html: string, property: string): string | null {
  // <meta property="og:title" content="..."> — 속성 순서가 뒤집힌 경우도 받는다
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decode(m[1]);
  }
  return null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export async function fetchLinkMeta(
  url: string,
): Promise<{ title: string | null; description: string | null; thumbnail: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const html = await res.text();
    const fallback = decode(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '');
    const title = meta(html, 'og:title') ?? (fallback || null);
    // 검색 신호용 — og:description 우선, 없으면 일반 description. 유튜브는 여기에 영상 설명이 통째로 온다.
    const description = meta(html, 'og:description') ?? meta(html, 'description');
    return { title, description, thumbnail: meta(html, 'og:image') };
  } finally {
    clearTimeout(timer);
  }
}

// 앱이 포그라운드로 올라올 때 호출 — 제목이 빈 링크 파편을 뒤늦게 채운다.
export async function backfillLinkMeta(): Promise<void> {
  let pending: { id: string; content: string }[];
  try {
    pending = await fetchLinksMissingMeta(BATCH);
  } catch {
    return; // 조회 실패는 조용히 넘긴다 — 다음 포그라운드에서 다시
  }

  await Promise.all(
    pending.map(async (fr) => {
      try {
        const { title, description, thumbnail } = await fetchLinkMeta(fr.content);
        if (!title && !description && !thumbnail) return;
        // 새 링크는 여기서 제목·설명을 한 번에 받는다. 기존 링크(제목 이미 있음)는 이 경로로 안 오므로
        // 설명 백필은 일회성 scripts/backfill-link-desc.mjs가 담당한다.
        await updateFragment(fr.id, {
          link_title: title,
          link_description: description,
          link_thumbnail_url: thumbnail,
        });
      } catch {
        // 이 링크는 그냥 둔다 (PLAN §3.6)
      }
    }),
  );
}
