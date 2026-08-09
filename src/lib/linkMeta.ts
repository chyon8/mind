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

// 코드포인트 하나를 문자로. 범위를 벗어난 쓰레기 입력은 원문 그대로 남긴다(fromCodePoint가 throw).
function fromCode(n: number, raw: string): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
}

// 숫자 엔티티는 **16진수까지** 푼다. Threads는 한글을 전부 &#xc724; 형태로 escape해서 내려주는데
// 10진수만 풀던 시절엔 제목·본문이 통째로 "&#xc724;&#xc790;..."로 저장돼 읽을 수가 없었다
// (2026-08-09). 이건 Threads 전용 대응이 아니라 모든 사이트에 걸리는 디코더 버그였다.
// fromCodePoint를 쓰는 이유: 이모지(&#x1F600; 같은 astral)를 fromCharCode는 못 만든다.
function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (raw, h) => fromCode(parseInt(h, 16), raw))
    .replace(/&#(\d+);/g, (raw, n) => fromCode(Number(n), raw)) // 레딧은 공백까지 &#32;로 준다
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

// HTML 조각 → 읽을 수 있는 평문. 블록 태그를 줄바꿈으로 바꾼 뒤 나머지 태그를 지운다.
// 예전엔 태그를 전부 공백으로 바꾸고 \s+를 공백 하나로 뭉갰는데, 그러면 원문의 문단·목록이
// 통째로 사라져 글이 벽처럼 이어졌다("주르륵", 2026-08-09 유저 지적).
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(?:p|div|li|ul|ol|h[1-6]|blockquote|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decode(withBreaks)
    .replace(/[^\S\n]+/g, ' ') // 가로 공백만 정리한다 — 줄바꿈은 살려야 한다
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n') // 빈 줄은 최대 하나까지
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

// 아이폰 공유 시트가 주는 링크는 /r/xxx/s/짧은코드 형식인데, old.reddit.com은 이 형식을
// 모르고 로그인 페이지로 보낸다 — 그 페이지 제목("Reddit에 오신 걸 환영합니다")이 그대로
// 저장되는 사고가 있었다(2026-08-09). www가 리다이렉트로 알려주는 실제 /comments/ 경로를
// 먼저 알아낸 뒤 호스트를 바꾼다.
//
// ⚠️ Location 헤더를 읽으면 안 된다. RN의 fetch는 whatwg-fetch(XHR) 폴리필이라
// `redirect: 'manual'`을 **조용히 무시하고** 항상 리다이렉트를 따라간다 — 헤더 방식은 앱에서
// 절대 동작하지 않는다(Node에서만 되는 걸 보고 넣었다가 이 사고가 났다). 따라간 뒤의 최종
// 주소인 res.url(= xhr.responseURL, RN도 채운다)이 유일하게 믿을 수 있는 값이다.
async function redditFetchUrl(url: string, signal: AbortSignal): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isRedditUrl(u) || u.hostname === 'old.reddit.com') return null;

  if (/\/s\/[^/]+\/?$/.test(u.pathname)) {
    u.hostname = 'www.reddit.com'; // 단축링크 해석은 www만 안다
    const res = await fetch(u.toString(), { signal });
    try {
      u = new URL(res.url);
    } catch {
      return null;
    }
    // 해석이 안 됐으면(여전히 /s/) old로 보내봐야 로그인 페이지다 — 포기하고 원본으로 둔다
    if (!isRedditUrl(u) || /\/s\/[^/]+\/?$/.test(u.pathname)) return null;
  }
  u.hostname = 'old.reddit.com';
  return u.toString();
}

// 챌린지/로그인 페이지를 제목이라고 저장하지 않는다. 저장을 건너뛰면 link_title이 null로 남아
// 다음 포그라운드에 자동으로 다시 시도한다 — 쓰레기 제목이 박히는 것보다 낫다.
// 문구는 기기 언어를 타므로("Welcome to Reddit" / "Reddit에 오신 걸 환영합니다") 경로로 판정하고,
// 챌린지 페이지의 <title>만 언어와 무관하게 늘 "Reddit"이라 그것만 문자열로 거른다.
function isRedditJunk(finalUrl: string, title: string | null): boolean {
  try {
    const u = new URL(finalUrl);
    if (!isRedditUrl(u)) return false;
    return u.pathname.startsWith('/login') || title === 'Reddit';
  } catch {
    return false;
  }
}

// 레딧 글 본문(selftext). og:description은 레딧이 150자 안팎에서 "…"로 잘라 보내기 때문에
// 임베딩 신호로도 약하고 상세 화면에도 잘린 채 뜬다 — old.reddit.com은 본문 전체를 페이지에
// 그대로 담고 있으므로 그걸 쓴다. 본문이 없는 글(이미지·영상만)이면 null → og로 폴백한다.
//
// 경계 두 개가 핵심이고, 둘 다 실제로 틀렸다가 잡은 것들이다(2026-08-09):
//   (1) 글(/comments/)일 때만 본다 — 서브레딧 목록 페이지에선 첫 .md가 "보관된 글입니다" 공지다.
//   (2) 댓글 영역 앞에서 끊는다 — 본문 없는 글에서 모더레이터 봇 댓글이 본문으로 잡혔다.
const SELFTEXT_MAX = 2000; // 임베딩 신호로 충분하고, 긴 글이 행을 부풀리지 않을 정도

function extractRedditSelftext(html: string, finalUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(finalUrl);
  } catch {
    return null;
  }
  if (!isRedditUrl(u) || !u.pathname.includes('/comments/')) return null;

  const start = html.indexOf('id="siteTable"');
  if (start < 0) return null;
  const commentarea = html.indexOf('commentarea', start);
  const zone = html.slice(start, commentarea > start ? commentarea : undefined);

  const m = zone.match(/<div class="md">([\s\S]*?)<\/div><\/div>/);
  if (!m) return null;
  const text = htmlToText(m[1]);
  return text ? text.slice(0, SELFTEXT_MAX) : null;
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
    const res = await fetch((await redditFetchUrl(url, ctrl.signal)) ?? url, {
      signal: ctrl.signal,
    });
    const html = await res.text();
    // og 태그와 <title>은 <head> 안에만 있다. 유튜브 같은 1~2MB짜리 페이지 **전문**에
    // `<meta[^>]+...` 정규식을 네 번 돌리면 그동안 JS 스레드가 통째로 막혀 첫 화면 렌더가 밀린다.
    // </head>를 못 찾는 페이지만 앞 200KB로 자른다.
    const headEnd = html.indexOf('</head>');
    const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 200_000);
    const fallback = decode(head.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '');
    const title = meta(head, 'og:title') ?? (fallback || null);
    // 레딧이 실제 글 대신 챌린지/로그인 페이지를 준 경우 — 아무것도 못 받은 것으로 취급한다
    if (isRedditJunk(res.url || url, title)) {
      return { title: null, description: null, thumbnail: null };
    }
    // 검색 신호용. 유튜브는 홍보 문구 오염 때문에 실제 재생 데이터에서 따로 뽑는다 —
    // ytInitialPlayerResponse는 body에 있으므로 여기만 전문을 본다(리터럴 앵커라 스캔이 싸다).
    const description = isYoutubeUrl(url)
      ? extractYoutubeDescription(html)
      : (extractRedditSelftext(html, res.url || url) ??
        meta(head, 'og:description') ??
        meta(head, 'description'));
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
