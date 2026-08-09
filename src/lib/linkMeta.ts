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

function isYoutubeUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

// reddit.com(신버전)은 서버사이드 fetch에 og 태그 없는 봇 차단/JS 챌린지 페이지를 내려준다 —
// <title>이 그냥 "Reddit"뿐이라 실측 결과 링크 제목이 전부 "Reddit"으로만 남았다(2026-08-09).
// old.reddit.com은 같은 경로로 실제 제목·og:title이 박힌 HTML을 그대로 준다 — 저장은 원본
// URL 그대로 하고, fetch할 때만 호스트를 바꾼다.
function isRedditUrl(u: URL): boolean {
  return u.hostname === 'reddit.com' || u.hostname.endsWith('.reddit.com');
}

function redditFetchUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!isRedditUrl(u) || u.hostname === 'old.reddit.com') return null;
    u.hostname = 'old.reddit.com';
    return u.toString();
  } catch {
    return null;
  }
}

// 공유 시트에서 던진 링크는 대부분 /r/xxx/s/짧은코드 형식이다 — old.reddit.com은 이 형식을
// 모르고 로그인 페이지로 보낸다. www.reddit.com은 이 리다이렉트만은 챌린지 없이 301로 실제
// /comments/... 경로를 알려주므로, 헤더만 받아 실제 경로로 바꾼 다음 old.reddit.com으로 청한다.
async function resolveRedditShortlink(url: string, signal: AbortSignal): Promise<string> {
  const u = new URL(url);
  if (!isRedditUrl(u) || !/\/s\/[^/]+\/?$/.test(u.pathname)) return url;
  if (u.hostname === 'old.reddit.com') u.hostname = 'www.reddit.com'; // 리다이렉트는 www만 안다
  const res = await fetch(u.toString(), { redirect: 'manual', signal });
  return res.headers.get('location') || url;
}

// 유튜브는 설명 없는 영상의 og:description에 사이트 홍보 문구를 채워 넣는다 — 영상마다 똑같은
// 텍스트라 임베딩하면 무관한 영상들이 서로 유사하다는 노이즈가 된다. 대신 페이지에 그대로 박혀있는
// 실제 재생 데이터(ytInitialPlayerResponse)의 shortDescription을 읽는다 — 진짜 없으면 빈 문자열이고
// 그건 null로 취급한다 ("없으면 없다").
function extractYoutubeDescription(html: string): string | null {
  const m = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
  if (!m) return null;
  try {
    const text = JSON.parse(`"${m[1]}"`) as string;
    return text || null;
  } catch {
    return null;
  }
}

export async function fetchLinkMeta(
  url: string,
): Promise<{ title: string | null; description: string | null; thumbnail: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resolved = await resolveRedditShortlink(url, ctrl.signal);
    const res = await fetch(redditFetchUrl(resolved) ?? resolved, { signal: ctrl.signal });
    const html = await res.text();
    // og 태그와 <title>은 <head> 안에만 있다. 유튜브 같은 1~2MB짜리 페이지 **전문**에
    // `<meta[^>]+...` 정규식을 네 번 돌리면 그동안 JS 스레드가 통째로 막혀 첫 화면 렌더가 밀린다.
    // </head>를 못 찾는 페이지만 앞 200KB로 자른다.
    const headEnd = html.indexOf('</head>');
    const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 200_000);
    const fallback = decode(head.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '');
    const title = meta(head, 'og:title') ?? (fallback || null);
    // 검색 신호용. 유튜브는 홍보 문구 오염 때문에 실제 재생 데이터에서 따로 뽑는다 —
    // ytInitialPlayerResponse는 body에 있으므로 여기만 전문을 본다(리터럴 앵커라 스캔이 싸다).
    const description = isYoutubeUrl(url)
      ? extractYoutubeDescription(html)
      : (meta(head, 'og:description') ?? meta(head, 'description'));
    return { title, description, thumbnail: meta(head, 'og:image') };
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
