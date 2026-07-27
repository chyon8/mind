// 아이디어 슬롯의 **마지막 테스트** (2026-07-27). 이게 안 되면 idea 슬롯은 접는다.
//
// ── 왜 이 설계인가 ─────────────────────────────────────────────────────────
// 지금까지 나온 각도는 전부 **소재가 이어진 확장**이었다 (유저 판정):
//   유럽 여행 파편 → `creative coliving Europe` / 문학 파편 → `literary hotels`
//   Stream Deck 파편 → `programmable foot pedal`
// idea의 정의(RUDY-DISCOVERY §9)는 "소재는 끊고 동기를 잇는다"인데 소재를 한 번도 못 끊었다.
// 프롬프트로 "동기를 뽑아라"라고만 하면 모델이 동기를 뽑고도 같은 소재로 돌아온다.
//
// 그래서 두 가지를 동시에 건다 — 이건 변수 분리 실험이 아니라 **최선을 다한 한 방**이다:
//   ① **금지어 선언 강제.** 각 발견마다 출발 파편의 소재어를 모델이 먼저 적게 하고,
//      그 단어를 검색어에 쓰지 못하게 한다. 선언시켜야 조용히 되돌아가지 못한다.
//   ② **네이티브 web_search.** 지금까지 전부 "각도 1개 → 검색 1번"이었다. 모델이 결과를 읽고
//      다시 검색하는 구조는 한 번도 안 돌려봤다 (이전 버전은 갈래를 강제로 줘서 무효였다).
//
// ⚠️ **갈래(물건/소프트웨어/공간/문화/사람/일하는방식)는 삭제했다.** 내가 만든 목록이었고
//    유저가 쓰지 말라고 했다. 다시 넣지 마라.
// ⚠️ 재료에서 **루디 자신의 브리핑 문장을 걷어낸다.** 07-27 실측: 재료 57개 중 9개가 루디가
//    쓴 브리핑 제목이었다(유저가 저장). 루디가 자기 출력을 유저 생각인 줄 알고 읽고 있었다.
//
// 실행: node scripts/check-idea-native.mjs        (1회)
//       node scripts/check-idea-native.mjs 2      (2회 — 반복되는지)

import { loadEnv, makeClient, recentBriefContext } from './_discovery-lib.mjs';

const MODEL = 'gpt-5.5';
const N_FIND = 5;

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

const SYS = `너는 이 사람을 위해 바깥에서 구경거리를 찾아온다.
**웹 검색 도구가 있다. 한 번에 끝내지 마라 — 찾고, 읽고, 실마리가 보이면 다시 검색해라.**
좋은 발견은 대개 첫 검색이 아니라 두세 번째 검색에서 나온다.

## 이 사람의 취향
${LENS}

## 제일 중요한 규칙 — 소재를 끊어라
저장물은 **이 사람이 왜 그것에 끌렸는지(동기)를 읽는 용도**다. 저장한 것을 더 찾아오라는 게 아니다.

발견 하나를 만들 때 반드시 이 순서로 한다:
1. 출발 파편 하나를 고른다.
2. **동기**를 한 줄로 쓴다 — "왜 이걸 저장했나". 물건 이름이 아니라 욕구·상태로 쓴다.
3. **금지어**를 3~5개 적는다. 그 파편에 들어 있는 소재 단어들이다
   (예: 파편이 유럽 여행이면 금지어는 유럽·여행·트립·europe·travel).
4. **금지어를 하나도 안 쓴 검색어**로 검색한다. 같은 동기를 가진 **완전히 다른 소재**를 찾는다.

⚠️ 금지어의 번역·동의어도 금지다. "유럽"을 막았으면 "europe"도 "해외체류"도 안 된다.
⚠️ 검색 결과가 결국 그 소재로 돌아오면 **버리고 다른 소재로 다시 검색해라.** 그게 실패다.

예시 (형식만 봐라, 내용은 복사하지 마라):
  파편: 키캡 3D 프린팅 쇼츠
  동기: 작은 물성을 손으로 만지고 남에게 자랑하고 싶다
  금지어: 키캡 / 키보드 / keycap / 3D프린팅
  검색어: enamel pin small batch makers   ← 소재가 완전히 다르다. 동기만 같다.

## 찾을 것
실제로 존재하는 **물건·프로젝트·제품·공간·씬** ${N_FIND}개.
- 개념 설명 글, "N Best…" 리스티클, 마케팅 랜딩페이지는 버려라. **실물**이라야 한다.
- <이미 다룬 주제>에 있는 건 다시 꺼내지 마라.
- 다섯 개가 서로 다른 동기에서 나와야 한다. 한 동기를 다섯 번 우려내지 마라.

## 출력 (마크다운, 다른 말 붙이지 마라)
찾은 것마다:
### 이름 — URL
출발 파편 / 동기 / 금지어 / 왜 이 사람이 볼 만한지 한 줄.`;

// 재료 — 루디 자신의 브리핑 문장을 걷어낸다 (07-27 실측: 57개 중 9개).
async function loadMaterial() {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const cols = 'id, created_at, type, content, link_title, link_description';
  const [fragRes, mapRes, projRes] = await Promise.all([
    supabase.from('fragments').select(cols).eq('archived', false).gte('created_at', since)
      .order('created_at', { ascending: false }),
    supabase.from('fragment_projects').select('fragment_id, project_id'),
    supabase.from('projects').select('id, name, status'),
  ]);
  // active 프로젝트 소속은 뺀다 — 그건 확장의 재료다.
  const activeIds = new Set((projRes.data ?? []).filter((p) => p.status === 'active').map((p) => p.id));
  const inActive = new Set(
    (mapRes.data ?? []).filter((m) => activeIds.has(m.project_id)).map((m) => m.fragment_id),
  );
  let frags = (fragRes.data ?? []).filter((f) => !inActive.has(f.id));
  const before = frags.length;

  const prior = await recentBriefContext(supabase);
  const norm = (s) => s.replace(/^\[[^\]]+\]\s*/, '').replace(/[""''`·\s"]/g, '').toLowerCase();
  const titles = prior.topics.map(norm);
  // 조립 프롬프트가 시키는 제목 문형("X는 A가 아니라 B다"). 짧은 생활메모는 안 걸리게 길이 조건.
  const claimish = /(아니라|보다 먼저|보다 ['’“"].{2,}['’”"]|일 수 있다|되고 있다|굳고 있다|이어야 한다|가 낫다)/;
  const dropped = [];
  frags = frags.filter((f) => {
    if (f.type !== 'text') return true;
    const txt = (f.content ?? '').replace(/\s+/g, ' ').trim();
    const n = norm(txt);
    const exact = n.length >= 12 && titles.some((t) => t.includes(n.slice(0, 20)) || n.includes(t.slice(0, 20)));
    if (exact || (txt.length > 28 && claimish.test(txt))) { dropped.push(txt); return false; }
    return true;
  });

  const line = (f) => {
    const t = f.type === 'link' && f.link_title ? `『${f.link_title}』 ` : '';
    const body = (f.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
    const desc = f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 100)}` : '';
    return `  - ${t}${body}${desc}`;
  };
  return { block: frags.map(line).join('\n'), count: frags.length, before, dropped, prior };
}

// gpt-5.5 단가 (_shared/usage.ts와 동일). web_search 호출료는 여기 안 잡힌다.
const PRICE = { in: 5.0, out: 30.0 };

async function run(n, user) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.openai}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      tools: [{ type: 'web_search' }],
      input: [{ role: 'system', content: SYS }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j = await res.json();

  // 모델이 **실제로 친 검색어**. Exa 파이프라인의 '각도'에 해당한다 — 여기가 제일 볼 만하다.
  const queries = (j.output ?? [])
    .filter((o) => o.type === 'web_search_call')
    .map((o) => o.action?.query ?? o.action?.type ?? '(?)');

  const msg = (j.output ?? []).find((o) => o.type === 'message');
  const text = (msg?.content ?? []).map((c) => c.text ?? '').join('\n');

  const u = j.usage ?? {};
  const cost = ((u.input_tokens ?? 0) * PRICE.in + (u.output_tokens ?? 0) * PRICE.out) / 1e6;

  let out = `\n${'█'.repeat(72)}\n  ${n}회차 — 검색 ${queries.length}번\n${'█'.repeat(72)}\n`;
  out += `\n[모델이 실제로 친 검색어]\n${queries.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}\n`;
  out += `\n[찾아온 것]\n${text.trim() || '(없음)'}\n`;
  out += `\n  💰 입력 ${u.input_tokens ?? '?'} · 출력 ${u.output_tokens ?? '?'} → $${cost.toFixed(4)}`
    + ` (+ web_search ${queries.length}건 별도 청구)\n`;
  console.log(out);
  return out;
}

async function main() {
  const runs = Number(process.argv[2]) || 1;
  const mat = await loadMaterial();
  console.log(`재료 ${mat.before}개 → 루디 출력 ${mat.dropped.length}개 제거 → ${mat.count}개`);
  console.log(`이미 다룬 주제 ${mat.prior.topics.length}개 · ${MODEL} + web_search\n`);

  const user = [
    `<저장물>\n${mat.block}\n</저장물>`,
    mat.prior.topics.length
      ? `<이미 다룬 주제 (다시 꺼내지 마라)>\n${mat.prior.topics.join(' / ')}\n</이미 다룬 주제>`
      : '',
  ].filter(Boolean).join('\n\n');

  for (let i = 1; i <= runs; i++) await run(i, user);
  console.log('\n판단: 소재가 실제로 끊겼나? 검색을 몇 번 했나? 실물이 나왔나?');
  console.log('안 끊겼으면 idea 슬롯은 접는다 (RUDY-DISCOVERY §1 제외 영역 원칙).');
}

main().catch((e) => { console.error(e); process.exit(1); });
