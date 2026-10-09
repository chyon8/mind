// PLAN.md §3.6 — 저장은 즉시, 메타데이터는 나중에.
// RN의 fetch는 CORS 제약이 없어 브라우저와 달리 HTML을 직접 받아 파싱할 수 있다.
// 실패한 것은 그냥 둔다 — URL 원문이 이미 있으므로 기능 손실이 없다. 재시도 카운터 없음.

import { markFragmentUpdated } from './fragmentUpdates';
import { fetchLinksMissingMeta, updateFragment } from './supabase';

const BATCH = 10; // 포그라운드 진입 1회당 처리할 파편 수 (PLAN §3.6)
const TIMEOUT_MS = 8000;

function meta(html: string, property: string): string | null {
  // <meta property="og:title" content="..."> — 속성 순서가 뒤집힌 경우도 받는다.
  // content는 여는 따옴표와 같은 따옴표에서 끝난다 — 예전 [^"']+는 content="It's..."를
  // 아포스트로피에서 잘랐다.
  const value = `content=(?:"([^"]*)"|'([^']*)')`;
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+${value}`, 'i'),
    new RegExp(`<meta[^>]+${value}[^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const v = m?.[1] ?? m?.[2];
    if (v) return decode(v);
  }
  return null;
}

// head 밖에 og 태그를 두는 사이트용. 전문에 정규식을 돌리면 JS 스레드가 막히므로(아래 head 주석)
// 리터럴로 위치만 찾고 그 <meta> 태그 하나에만 정규식을 건다.
function metaAnywhere(html: string, property: string): string | null {
  for (const q of ['"', "'"]) {
    const i = html.indexOf(`${q}${property}${q}`);
    if (i < 0) continue;
    const start = html.lastIndexOf('<meta', i);
    const end = html.indexOf('>', i);
    if (start >= 0 && end > i) return meta(html.slice(start, end + 1), property);
  }
  return null;
}

// 코드포인트 하나를 문자로. 범위를 벗어난 쓰레기 입력은 원문 그대로 남긴다(fromCodePoint가 throw).
function fromCode(n: number, raw: string): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
}

const NAMED: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
  laquo: '«', raquo: '»', deg: '°', times: '×',
  copy: '©', reg: '®', trade: '™',
};

// 숫자 엔티티는 **16진수까지** 푼다. Threads는 한글을 전부 &#xc724; 형태로 escape해서 내려주는데
// 10진수만 풀던 시절엔 제목·본문이 통째로 "&#xc724;&#xc790;..."로 저장돼 읽을 수가 없었다
// (2026-08-09). 이건 Threads 전용 대응이 아니라 모든 사이트에 걸리는 디코더 버그였다.
// fromCodePoint를 쓰는 이유: 이모지(&#x1F600; 같은 astral)를 fromCharCode는 못 만든다.
function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (raw, h) => fromCode(parseInt(h, 16), raw))
    .replace(/&#(\d+);/g, (raw, n) => fromCode(Number(n), raw)) // 레딧은 공백까지 &#32;로 준다
    // 이름 엔티티는 한 번에 훑는다 — 순차 replace는 &amp;lt;를 두 번 풀어 <로 만든다.
    // 활자 기호(&ldquo; 등)가 빠져 있어서 musicradar 제목이 "&ldquo;We strongly..."로 저장됐다.
    .replace(/&(nbsp|amp|lt|gt|quot|apos|ldquo|rdquo|lsquo|rsquo|mdash|ndash|hellip|middot|bull|laquo|raquo|deg|times|copy|reg|trade);/g,
      (raw, name) => NAMED[name] ?? raw)
    // 보이지 않는 C0 제어문자를 턴다(줄바꿈·탭은 살린다).
    // 네이버 플레이스는 og:title 끝에 U+001C를 붙여 보내는데, 화면엔 안 보이면서 제목 끝
    // 비교(" : 네이버" 제거)와 검색어 매칭을 조용히 깨뜨린다(2026-08-09).
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
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

function isRedditUrl(u: URL): boolean {
  return u.hostname === 'reddit.com' || u.hostname.endsWith('.reddit.com');
}

// 공식 oEmbed가 있는 곳은 HTML 대신 거기서 제목을 받는다. HTML은 사이트가 구조를 바꾸면 깨지지만
// oEmbed는 임베드용 공개 API라 형태가 고정돼 있다. 둘 다 실제로 깨져서 옮겼다(2026-10-09 실측):
//   - 유튜브: og:title이 </head> 뒤(본문 56만 자 지점)에 있어서 head만 읽던 파서가 <title>의
//     "YouTube"를 제목으로 저장했다(4건).
//   - 레딧: 우회로로 쓰던 old.reddit.com과 .rss가 둘 다 로그인 페이지로 리다이렉트되기 시작해
//     2026-08-25 이후 공유한 레딧 링크가 전부 제목 없이 남았다(5건). www는 og 없는 챌린지 페이지다.
function oembedEndpoint(url: string): string | null {
  if (isYoutubeUrl(url)) return 'https://www.youtube.com/oembed?format=json&url=';
  try {
    if (isRedditUrl(new URL(url))) return 'https://www.reddit.com/oembed?url=';
  } catch {
    return null;
  }
  return null;
}

async function fetchOembed(
  url: string,
  signal: AbortSignal,
): Promise<{ title: string | null; thumbnail: string | null } | null> {
  const endpoint = oembedEndpoint(url);
  if (!endpoint) return null;
  const res = await fetch(endpoint + encodeURIComponent(url), { signal });
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: unknown; thumbnail_url?: unknown };
  return {
    title: typeof j.title === 'string' && j.title ? decode(j.title) : null,
    thumbnail: typeof j.thumbnail_url === 'string' ? j.thumbnail_url : null,
  };
}

// 레딧 oEmbed는 공유 시트가 주는 단축링크(/r/xxx/s/코드)를 400으로 거절한다. www로 한 번 열면
// 실제 /comments/ 주소로 리다이렉트되므로 그 최종 주소를 쓴다.
// ⚠️ Location 헤더를 읽으면 안 된다. RN의 fetch는 whatwg-fetch(XHR) 폴리필이라
// `redirect: 'manual'`을 **조용히 무시하고** 항상 리다이렉트를 따라간다. 따라간 뒤의 최종
// 주소인 res.url(= xhr.responseURL, RN도 채운다)이 유일하게 믿을 수 있는 값이다.
async function redditOembedUrl(url: string, signal: AbortSignal): Promise<string | null> {
  const u = new URL(url);
  if (!/\/s\/[^/]+\/?$/.test(u.pathname)) return url;
  u.hostname = 'www.reddit.com'; // 단축링크 해석은 www만 안다
  const res = await fetch(u.toString(), { signal });
  return res.url.includes('/comments/') ? res.url : null;
}

// 레딧은 HTML로 받을 수 있는 게 없다 — oEmbed만 쓴다. oEmbed엔 본문이 없어 설명은 비운다.
// 실패하면 전부 null → link_title이 비어 있으니 다음 포그라운드에 자동으로 다시 시도한다.
async function fetchRedditMeta(
  url: string,
  signal: AbortSignal,
): Promise<{ title: string | null; description: string | null; thumbnail: string | null }> {
  const target = await redditOembedUrl(url, signal);
  const o = target ? await fetchOembed(target, signal) : null;
  return { title: o?.title ?? null, description: null, thumbnail: null };
}

// 네이버 지도(map.naver.com)는 서버사이드 fetch에 og:title도 <title>도 없는 2KB짜리 SPA 껍데기를
// 준다 — og:image의 지도 기본 이미지만 건져져서 제목 없는 파편이 됐다(2026-08-09, '갈만한곳' 2건).
// 같은 장소를 m.place.naver.com으로 부르면 SSR된 진짜 og 태그가 온다. 단 **모바일 UA일 때만** —
// 기본/데스크톱 UA엔 똑같이 껍데기(7KB)를 준다. 그래서 이 경로만 UA를 붙여 부른다.
const NAVER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// 공유 시트가 주는 naver.me 단축링크는 map.naver.com/p/entry/place/{id}로 풀린다.
// 레딧과 같은 이유로 res.url을 쓴다 — Location 헤더는 RN에서 못 읽는다(위 §redditOembedUrl 참고).
// 장소 id를 못 찾으면(지도 검색·블로그 등) null → 원본 URL 그대로 범용 경로를 탄다.
async function naverPlaceFetchUrl(url: string, signal: AbortSignal): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'naver.me' && !u.hostname.endsWith('naver.com')) return null;

  if (u.hostname === 'naver.me') {
    const res = await fetch(url, { signal });
    try {
      u = new URL(res.url);
    } catch {
      return null;
    }
  }
  if (u.hostname === 'm.place.naver.com') return u.toString(); // UA만 붙이면 되는 주소
  const id = u.pathname.match(/\/place\/(\d+)/)?.[1] ?? u.searchParams.get('pinId');
  return id ? `https://m.place.naver.com/place/${id}/home` : null;
}

// 네이버 플레이스의 og:description은 "방문자리뷰 148 · 블로그리뷰 561"이다 — 장소마다 모양이
// 같아서 임베딩 신호로는 유튜브 홍보 문구와 똑같은 노이즈다. 대신 페이지에 실려오는 업종·도로명
// 주소를 쓴다("카페,디저트 · 서울 중구 을지로35길 51-4"). 둘 다 없으면 null → og로 폴백한다.
function extractNaverPlaceInfo(html: string): string | null {
  const pick = (key: string) => html.match(new RegExp(`"${key}":"([^"]+)"`))?.[1];
  const info = [pick('category'), pick('roadAddress')].filter(Boolean);
  return info.length ? info.join(' · ') : null;
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
    let isReddit = false;
    try {
      isReddit = isRedditUrl(new URL(url));
    } catch {
      // URL이 아니면 아래 fetch가 실패하고 그냥 둔다
    }
    if (isReddit) return await fetchRedditMeta(url, ctrl.signal);

    // 유튜브는 제목·썸네일을 oEmbed에서 받고, 설명만 페이지에서 뽑는다(아래 extractYoutubeDescription)
    const oembed = isYoutubeUrl(url) ? await fetchOembed(url, ctrl.signal).catch(() => null) : null;

    const naverUrl = await naverPlaceFetchUrl(url, ctrl.signal);
    const res = await fetch(naverUrl ?? url, {
      signal: ctrl.signal,
      ...(naverUrl ? { headers: { 'User-Agent': NAVER_UA } } : {}),
    });
    // 에러 응답의 <title>을 제목이라고 저장하지 않는다. Cloudflare는 봇 차단 페이지를 **403과 함께**
    // 주는데 status를 안 보던 시절엔 그 페이지 제목("Just a moment...")이 그대로 박혔다 —
    // producthunt·kvraudio·dreamtonics 12건이 전부 이것이었다(2026-08-12 실측, 브라우저 UA로도 403).
    if (!res.ok) {
      return { title: oembed?.title ?? null, description: null, thumbnail: oembed?.thumbnail ?? null };
    }
    const html = await res.text();
    // og 태그와 <title>은 보통 <head> 안에 있다. 유튜브 같은 1~2MB짜리 페이지 **전문**에
    // `<meta[^>]+...` 정규식을 네 번 돌리면 그동안 JS 스레드가 통째로 막혀 첫 화면 렌더가 밀린다.
    // </head>를 못 찾는 페이지만 앞 200KB로 자른다. head에 없으면 metaAnywhere로 한 번 더 찾는다.
    const headEnd = html.indexOf('</head>');
    const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 200_000);
    const og = (property: string) => meta(head, property) ?? metaAnywhere(html, property);
    const fallback = decode(head.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '');
    // 네이버 플레이스는 og:title 끝에 " : 네이버"를 붙인다 — 장소 이름만 남긴다.
    const title =
      oembed?.title ?? (og('og:title') ?? (fallback || null))?.replace(/ : 네이버$/, '') ?? null;
    // 검색 신호용. 유튜브는 홍보 문구 오염 때문에 실제 재생 데이터에서 따로 뽑는다 —
    // ytInitialPlayerResponse는 body에 있으므로 여기만 전문을 본다(리터럴 앵커라 스캔이 싸다).
    const description = isYoutubeUrl(url)
      ? extractYoutubeDescription(html)
      : ((naverUrl ? extractNaverPlaceInfo(html) : null) ??
        og('og:description') ??
        meta(head, 'description'));
    return { title, description, thumbnail: oembed?.thumbnail ?? og('og:image') };
  } finally {
    clearTimeout(timer);
  }
}

// 링크 파편 하나의 제목·설명·썸네일을 받아 채운다. 받은 게 없으면 그대로 둔다.
// 채웠으면 열려 있는 목록이 다시 읽도록 알린다 — 안 그러면 다음 화면 진입까지 URL로 보인다.
export async function fillLinkMeta(fr: { id: string; content: string }): Promise<void> {
  const { title, description, thumbnail } = await fetchLinkMeta(fr.content);
  if (!title && !description && !thumbnail) return;
  await updateFragment(fr.id, {
    link_title: title,
    link_description: description,
    link_thumbnail_url: thumbnail,
  });
  markFragmentUpdated();
}

// 앱이 포그라운드로 올라올 때 호출 — 제목이 빈 링크 파편을 뒤늦게 채운다.
// 저장 직후엔 insertFragment가 바로 fillLinkMeta를 부른다. 이건 그게 실패했거나
// 웹(CORS로 직접 못 받음)에서 저장한 링크를 위한 재시도 경로다.
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
        await fillLinkMeta(fr);
      } catch {
        // 이 링크는 그냥 둔다 (PLAN §3.6)
      }
    }),
  );
}
