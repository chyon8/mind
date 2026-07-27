// idea 각도를 **두 단계로 쪼개서** 소재를 구조적으로 끊는다 (2026-07-27).
//
// ── 왜 두 단계인가 ─────────────────────────────────────────────────────────
// 지금까지 전부 "파편을 보여주면서 소재를 따라가지 마라"였다. 보고 있는데 쓰지 말라는 것이고,
// 실측상 안 지켜진다 — 금지어를 자기 입으로 선언시켜도 우회했다(07-27 네이티브 실험:
// 금지어 `사는 곳` 선언 → 검색어 `"creative residency" "community house"`. 단어만 피하고
// 소재는 그대로 갔다). **금지어는 단어를 막지 영역을 못 막는다.**
//
// 그래서 2단계 모델에게는 **소재를 아예 안 보여준다:**
//   1단계 — 재료 전체를 읽고 파편에서 **동기만** 뽑는다 (물건 이름 없이 욕구 문장으로)
//   2단계 — **파편을 안 준다. 동기 문장만 준다.** 그걸로 검색어를 만든다
// 2단계는 '키캡'이라는 단어를 본 적이 없어서 따라갈 수가 없다. 프롬프트 규칙이 아니라 구조다
// (RUDY-DISCOVERY §9 "막히면 규칙을 더 넣지 말고 빼라"에 안 걸린다).
//
// ⚠️ 이 스크립트는 **idea 슬롯만** 본다. expansion·lens·resurface는 지금 경로 그대로다.
// ⚠️ `<이미 다룬 주제>`를 일부러 안 준다. 07-27 실측에서 그 목록이 **재료로 역류**했다
//    (모델이 "다시 꺼내지 마라"고 준 브리핑 제목을 출발 파편으로 삼았다). 여기서 재는 건
//    "소재가 끊겼나" 하나다 — 반복 여부는 기록된 9회차와 눈으로 대조한다.
// ⚠️ 재료에서 루디 자신의 브리핑 문장을 걷어낸다 (07-27 실측: 55개 중 9개).
//
// 실행: node scripts/check-idea-2step.mjs        (1회)
//       node scripts/check-idea-2step.mjs 2      (2회 — 반복되는지)

import { callOpenAI, loadEnv, makeClient, recentBriefContext } from './_discovery-lib.mjs';

const MODEL = 'gpt-5.5';
const N = 5;

const env = loadEnv();
if (!env.url || !env.role || !env.openai) {
  console.error('SUPABASE/OPENAI 키가 필요하다 (.env)');
  process.exit(1);
}
const supabase = makeClient(env.url, env.role);

const LENS = `- 소스 결: Hacker News / Indie Hackers / Product Hunt.
- 적당히 기술적. **너무 기술적이거나 학술적인 건 안 본다 — 논문·리서치 금지.**
- "비슷한 프로덕트가 **실제로 있고 사람들이 쓴다**" — 개념 설명이 아니라 실물. 누가 만들었나.
- 다른 분야는 예술 자체가 아니라 **새로운 관점·트렌드·가서 볼 것**(전시·공간 등).
- **음악은 검색하지 마라.** 이 사람이 알아서 찾는다.`;

// ── 1단계: 파편 → 동기. 여기서 소재가 새면 2단계가 무의미해진다. ──────────────
const SYS_MOTIVE = `너는 이 사람의 저장물을 읽고 **왜 저장했는지(동기)만** 뽑는다.
아직 검색하지 않는다. 무엇을 찾을지도 정하지 않는다.

## 할 일
서로 다른 파편 ${N}개를 고르고, 각각의 **동기**를 한 줄로 쓴다.

## 동기를 쓰는 법 (제일 중요)
동기는 **욕구·상태**다. 물건이 아니다.
- ❌ "유럽에서 한 달 살아보고 싶다" — 장소가 들어 있다
- ❌ "키보드 키캡을 만들고 싶다" — 물건이 들어 있다
- ⭕ "익숙한 환경을 통째로 갈아엎어야 행동이 바뀐다고 믿는다"
- ⭕ "작은 물성을 손으로 만지고 남에게 자랑하고 싶다"

**동기 문장에 아래를 쓰지 마라:**
- 고유명사 (제품명·회사명·지명·언어명)
- 그 파편의 소재를 특정하는 명사 (키캡·책상·여행·앱·강의 같은 것)
- 업계 용어 (SaaS·대시보드·플랫폼)

⚠️ **여기에 "해결 방법·행동 동사를 쓰지 마라"를 추가했다가 되돌렸다 (2026-07-27 실측).**
실패 3건이 전부 동사형 동기였길래 동기를 상태·감정·믿음으로만 쓰게 조였는데,
**성공 개수는 6/10 그대로였고 다른 게 나빠졌다:** 전시·공간 갈래가 3개→0개로 사라지고
(전부 앱·커뮤니티로 쏠림), 회차 간 다양성이 줄었다(2회차가 1회차를 거의 그대로 반복).
감정만 남기면 감정에 제일 가까운 상품 카테고리가 앱이라 그쪽으로 빨려간다 —
전시·공간은 감정이 아니라 "가서 본다"는 행위로 연결되는데 그 고리가 끊긴다.
§4의 "전시/공간은 통하는 갈래다"를 죽이는 수정이었다. **다시 넣지 마라.**

동기만 읽었을 때 **원래 파편이 뭐였는지 못 알아맞혀야 제대로 쓴 것이다.**
그러면서도 사람의 욕구로서는 구체적이어야 한다 — "새로운 걸 원한다" 같은 건 너무 막연하다.

## 출력
JSON만: {"items":[{"frag":"출발 파편 원문 일부","motive":"동기 한 줄"}]}
frag는 내가 나중에 대조하려고 받는 것이다. 동기를 쓸 때 frag를 요약하지 마라 — 동기를 써라.`;

// ── 2단계: 동기만 보고 검색어. 파편은 절대 안 들어간다. ──────────────────────
const SYS_QUERY = `너는 이 사람이 구경할 만한 것을 찾을 검색어를 만든다.

## 이 사람의 취향
${LENS}

## 주어지는 것
이 사람이 무언가를 저장할 때의 **동기** ${N}개다. 무엇을 저장했는지는 너에게 주지 않는다.
알 필요도 없다 — 같은 동기를 가진 **아무 소재나** 찾으면 된다.

## 할 일
동기 하나당 검색어 하나. 그 동기를 가진 사람이 좋아할 **실제로 존재하는 물건·제품·공간·씬**을
찾을 검색어를 만든다.

## 검색어의 모양
- **질문이 아니라 영역이다.** "○○을 어떻게 하나" 같은 질문형은 그 문제를 파는 업체 페이지만 부른다.
- **물건·장르·씬의 이름**으로 채운다. 동사("어떻게","왜","하는 법")를 넣지 마라.
- 추상명사만 나열하지 마라 — "tactile object communities" 같은 건 아무것도 안 물어온다.
  **실제로 그 물건을 파는 사람들이 쓸 단어**를 써라.
- 이미 아주 유명한 제품 이름은 넣지 마라. 그 회사 홈페이지만 나온다.

## 출력
JSON만: {"angles":[{"motive":"받은 동기 그대로","query":"검색어","area":"무슨 영역인지 한 줄"}]}`;

async function loadMaterial() {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const cols = 'id, created_at, type, content, link_title, link_description';
  const [fragRes, mapRes, projRes] = await Promise.all([
    supabase.from('fragments').select(cols).eq('archived', false).gte('created_at', since)
      .order('created_at', { ascending: false }),
    supabase.from('fragment_projects').select('fragment_id, project_id'),
    supabase.from('projects').select('id, name, status'),
  ]);
  const activeIds = new Set((projRes.data ?? []).filter((p) => p.status === 'active').map((p) => p.id));
  const inActive = new Set(
    (mapRes.data ?? []).filter((m) => activeIds.has(m.project_id)).map((m) => m.fragment_id),
  );
  let frags = (fragRes.data ?? []).filter((f) => !inActive.has(f.id));
  const before = frags.length;

  // 루디 자신의 브리핑 문장 걷어내기 (07-27 실측)
  const prior = await recentBriefContext(supabase);
  const norm = (s) => s.replace(/^\[[^\]]+\]\s*/, '').replace(/[""''`·\s"]/g, '').toLowerCase();
  const titles = prior.topics.map(norm);
  const claimish = /(아니라|보다 먼저|보다 ['’“"].{2,}['’”"]|일 수 있다|되고 있다|굳고 있다|이어야 한다|가 낫다)/;
  let cut = 0;
  frags = frags.filter((f) => {
    if (f.type !== 'text') return true;
    const txt = (f.content ?? '').replace(/\s+/g, ' ').trim();
    const n = norm(txt);
    const exact = n.length >= 12 && titles.some((t) => t.includes(n.slice(0, 20)) || n.includes(t.slice(0, 20)));
    if (exact || (txt.length > 28 && claimish.test(txt))) { cut++; return false; }
    return true;
  });

  const line = (f) => {
    const t = f.type === 'link' && f.link_title ? `『${f.link_title}』 ` : '';
    const body = (f.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
    const desc = f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 100)}` : '';
    return `  - ${t}${body}${desc}`;
  };
  return { block: frags.map(line).join('\n'), count: frags.length, before, cut };
}

const parse = (raw) => JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());

// 검색어에 출발 파편의 내용어가 남아 있나 — 기계적 1차 확인 (판정은 사람이 한다).
const STOP = new Set(['그리고','하는','있는','것을','수','더','좀','내','나','이','그','저','안','못','때','걸','및','the','a','an','of','for','to','and','in','on','with','app','apps']);
function leak(frag, query) {
  const words = frag.toLowerCase().match(/[a-z]{4,}|[가-힣]{2,}/g) ?? [];
  const q = query.toLowerCase();
  return [...new Set(words)].filter((w) => !STOP.has(w) && q.includes(w));
}

async function main() {
  const runs = Number(process.argv[2]) || 1;
  const mat = await loadMaterial();
  console.log(`재료 ${mat.before}개 → 루디 출력 ${mat.cut}개 제거 → ${mat.count}개 · ${MODEL}`);
  console.log('※ <이미 다룬 주제>는 일부러 안 준다 (재료로 역류하는 게 확인됐다)\n');

  for (let r = 1; r <= runs; r++) {
    // 1단계 — 재료 전체 → 동기
    const step1 = parse(await callOpenAI(env.openai, MODEL, SYS_MOTIVE,
      `<저장물>\n${mat.block}\n</저장물>`, `${r} 1단계 동기`));
    const items = (step1.items ?? []).slice(0, N);

    // 2단계 — **동기만** 넘긴다. frag는 안 넘어간다.
    const motiveOnly = items.map((it, i) => `${i + 1}. ${it.motive}`).join('\n');
    const step2 = parse(await callOpenAI(env.openai, MODEL, SYS_QUERY,
      `<동기>\n${motiveOnly}\n</동기>`, `${r} 2단계 검색어`));
    const angles = step2.angles ?? [];

    console.log(`\n${'█'.repeat(72)}\n  ${r}회차\n${'█'.repeat(72)}`);
    for (let i = 0; i < items.length; i++) {
      const a = angles[i] ?? {};
      const lk = leak(items[i].frag ?? '', a.query ?? '');
      console.log(`\n  파편   ${(items[i].frag ?? '').slice(0, 62)}`);
      console.log(`  동기   ${items[i].motive}`);
      console.log(`  검색어 ▸ ${a.query ?? '(없음)'}`);
      console.log(`         ${a.area ?? ''}`);
      if (lk.length) console.log(`  ⚠ 소재 누출: ${lk.join(', ')}`);
    }
  }
  console.log('\n판단: 검색어가 출발 파편의 소재를 따라갔나? 동기 문장이 소재를 흘리진 않았나?');
}

main().catch((e) => { console.error(e); process.exit(1); });
