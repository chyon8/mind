// Rudy 채팅 — RAG + 자발적 연결 + 스트리밍 (RUDY.md §4-C1 · §10-5, RUDY-BUILD.md C-1·C-2).
//
// ⚠️ 채팅은 touch가 아니다 (§2-3). 이 함수는 public.fragments를 select만 한다 —
//    근거로 읽었다는 이유로 파편이 선명해지면 "그냥 봤다고 선명해지면 안 된다"가 뒷문으로 깨진다.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  CHAT_MODEL,
  chatStream,
  complete,
  embedMany,
  FAST_MODEL,
  type ChatMessage,
  type UsageSink,
} from '../_shared/openai.ts';
import { costTracker } from '../_shared/usage.ts';
import { systemPrompt } from './prompt.ts';
import { axesBlock, findAxes, MIN_SIM as CLUSTER_MIN_SIM, type Axis } from './clusters.ts';
import { buildOrient, orientBlock, type OrientResult } from './orient.ts';
// pickQuestion·logQuestion(늦은 의도 §4-F1)은 2026-08-01에 호출을 뺐다 — intent.ts엔 그대로 있다.
import { captureAnswer, questionSubject } from './intent.ts';
import { kstDate, kstRange, kstToday, PERIOD_LABEL, type Period } from '../_shared/time.ts';
import { exaSearch } from '../discovery/search.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CITE_COUNT = 10; // 근거로 넘길 파편 수
// ⚠️ 점수 바닥 컷은 두지 않는다. 실측(2026-07-19, check-search.mjs): 질문 문장 임베딩은
// 관련 파편도 0.28~0.43에 깔려서, 어떤 바닥이든 신호를 자른다(충돌 튜닝 때 본 이방성과 동일).
// 관련성 판정은 근거를 직접 보는 모델이 한다 — 숫자 하나로 미리 자르는 게 더 나쁘다.

// ⚠️ 자발적 연결(§4-C1)은 2026-08-01에 **껐다.** 임계(0.34)를 넘긴 연결이 실제로는 무관해서,
//    모델이 "이게 지금과 무슨 관련이 있는지 모르겠어"라고 쓴 채로 파편을 들이밀었다(실측).
//    유저 결정: "내가 관련있는 거 물어보지 않으면 굳이 안 띄우는 게 좋겠다."
//    그 자리는 파편 상세의 `이거 관련 뭐 있었지` 칩이 받는다 — 사람이 눌렀을 때만, 공짜로.
//    되살리려면 이 커밋 이전의 findLink/LINK_THRESHOLD/LINK_COOLDOWN_DAYS를 보면 된다.
//    (RPC `collision_by_embedding`은 그대로 둔다 — 지우면 되살릴 때 SQL부터 다시 붙여야 한다.)
const HISTORY_LIMIT = 20; // 맥락으로 넘길 이전 메시지 수
const PERIOD_LIMIT = 40; // 기간 조회 상한 (하루에 40개 넘게 던지면 최신순으로 자른다)
// 전량 조회 상한 (2026-07-25 열거 경로 → 2026-07-29 기본 경로로 확대).
// 전수를 넘기는 게 핵심이라 넉넉하게 두되, 코퍼스가 수천 개로 자랐을 때 질문 하나가
// 수십만 토큰이 되는 것만 막는다. 넘치면 최신순으로 자른다.
// ⚠️ 300이었는데 실제 파편이 331개라 이미 오래된 31개가 조용히 잘리고 있었다 —
//    "빠뜨리지 마라"고 프롬프트에 적어놓고 재료에서 빼고 있었던 것. 실측(2026-07-29)으로
//    331개 = 24,567토큰이니 600개(≈45k)까지는 컨텍스트가 넉넉하다.
// ⚠️ 이 상한에 실제로 닿으면(파편 600개+) 싼 모델로 1차 필터를 거는 게 맞다 — 그때까진
//    통째로 넘기는 게 더 싸고 정확하다 (RUDY-STATUS.md ② 비용 메모).
const CORPUS_LIMIT = 600;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Frag = {
  id: string;
  created_at: string;
  type: string;
  content: string;
  link_title: string | null;
  link_description: string | null;
  note: string | null;
  archived: boolean;
};

const FRAG_COLS = 'id, created_at, type, content, link_title, link_description, note, archived';

// 프로젝트 한 조각. **description이 정답지다** — 이름만 보면 No phone을 미니멀폰으로,
// Caselab을 법률 프로덕트로 읽는다 (발견 쪽에서 실제로 터진 헛발질, material.ts 주석 참고).
type Proj = { id: string; name: string; description: string | null };

// 근거 한 조각. 모델이 [『제목』](mind://fragment/id)로 인용할 수 있게 id를 넣고,
// 프로젝트 소속과 원본 URL도 준다 — "링크 달라", "프로젝트로 가자"에 답할 재료.
function fragBlock(f: Frag, projects: Proj[]): string {
  const date = kstDate(f.created_at); // UTC로 찍으면 새벽 저장분이 하루 전으로 보인다
  const title = f.type === 'link' ? (f.link_title ?? f.content) : f.content;
  const lines = [
    `- id: ${f.id}`,
    `  날짜: ${date}`,
    `  내용: ${title.replace(/\n/g, ' ')}`,
  ];
  if (f.type === 'link') {
    lines.push(`  URL: ${f.content}`);
    if (f.link_description) lines.push(`  설명: ${f.link_description.replace(/\n/g, ' ')}`);
  }
  if (f.note) lines.push(`  덧: ${f.note.replace(/\n/g, ' ')}`);
  if (projects.length) {
    lines.push(
      `  프로젝트: ${projects
        .map((p) => `${p.name} (id: ${p.id})${p.description ? ` — ${p.description.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`)
        .join(', ')}`,
    );
  }
  return lines.join('\n');
}

// more_like가 종류를 뽑을 재료 (2026-08-02). 예전엔 앱이 만든 질문 문장(제목 80자)이 전부였다.
// 링크인데 제목이 아직 안 붙었으면 남는 건 퍼센트 인코딩된 URL뿐이라 종류를 못 뽑는다 —
// 실측: 잘린 apps.apple.com URL에서 "지키자"만 건져 앱 차단 앱을 퍼즐 게임으로 읽고
// 테트리스·애니팡을 물어왔다. 그럴 땐 null로 돌려 바깥에 아예 안 나간다 (§2-8 침묵).
function moreLikeMaterial(f: Frag): string | null {
  const title = (f.type === 'link' ? f.link_title : f.content)?.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const lines = [`제목: ${title.slice(0, 300)}`];
  if (f.link_description) lines.push(`설명: ${f.link_description.replace(/\s+/g, ' ').slice(0, 600)}`);
  if (f.note) lines.push(`내가 덧붙인 말: ${f.note.replace(/\s+/g, ' ').slice(0, 400)}`);
  return lines.join('\n');
}

// 열거 경로용 한 줄 (2026-07-25). fragBlock은 파편 하나가 여러 줄이라 전 파편에 곱하면
// 컨텍스트가 터진다 — 여기선 한 파편 = 한 줄. 링크의 URL은 안 싣는다(제목·설명이 신호 전부고,
// 원본 주소가 필요하면 유저가 그 파편을 탭한다). id는 남긴다 — 답에서 링크로 걸어야 하니까.
//
// ⚠️ `·무덤` 표시를 붙인다 (2026-07-29). 전에는 archived 여부가 재료에 아예 안 실려서,
//    모델이 2주 전에 흐려진 것과 어제 던진 것을 같은 무게로 읽었다. 무덤을 **빼는 게 아니라**
//    표시하는 게 처방이다 — 실측(2026-07-29) 331개 중 238개(72%)가 무덤이라 빼면 코퍼스가
//    지난 5일치만 남는다.
function enumLine(f: Frag): string {
  const raw = (f.type === 'link' ? (f.link_title ?? f.content) : f.content) ?? '';
  const title = raw.replace(/\s+/g, ' ').slice(0, 100);
  const desc = f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 100)}` : '';
  const note = f.note ? ` (덧: ${f.note.replace(/\s+/g, ' ').slice(0, 80)})` : '';
  const kind = `${f.type}${f.archived ? '·무덤' : ''}`;
  return `- ${kstDate(f.created_at)} [${kind}] ${title}${desc}${note} | id: ${f.id}`;
}

// 저장소 전량 블록 (2026-07-29) — 기본 갈래가 보는 재료.
//
// ⚠️ 전에는 이 자리가 **유사도 상위 10개**였고, 그게 "채팅이 멍청하다"의 뿌리였다.
//    실측: "오늘 집가서 뭐할까"에 앱 개발 버그 메모 10개가 갔다(Year 표시가 없네 / 반응형 /
//    모달끄면 저장안되는 문제 …). 원인은 주제어가 안 뽑히는 질문("나한테 필요한 게 뭐야")이
//    질문 원문으로 검색되는 오염 경로(위 EXTRACT_SYS 주석)로 떨어지기 때문.
//    → **331개 = 24,567토큰이라 통째로 들어간다. 이 크기에선 고르는 것보다 다 보여주는 게 낫다.**
//    (열거 경로가 이미 이 수법을 쓰고 있었다 — 라우터가 맞힐 때만 발동하던 걸 기본값으로 뒤집었다.)
//
// 프로젝트를 맨 위에 싣는다: "내가 뭘 만들고 있나"가 이 질문들의 제일 중요한 재료인데
// 전엔 이름+id만 갔다(RUDY-STATUS 다음 할 일 ③).
async function corpusBlock(): Promise<string> {
  const [fragRes, projRes] = await Promise.all([
    supabase
      .from('fragments')
      .select(FRAG_COLS)
      .order('created_at', { ascending: false })
      .limit(CORPUS_LIMIT),
    supabase.from('projects').select('name, status, description').order('created_at'),
  ]);
  const projects = ((projRes.data ?? []) as { name: string; status: string; description: string | null }[])
    .map((p) => `- ${p.name} (${p.status})${p.description ? ` — ${p.description.replace(/\s+/g, ' ')}` : ''}`)
    .join('\n');
  const frags = ((fragRes.data ?? []) as Frag[]).map(enumLine).join('\n');
  return [
    '=== 이 사람이 하고 있는 일 (프로젝트) ===',
    '※ 설명이 정답지다. 이름만 보고 넘겨짚지 마라.',
    projects || '(없음)',
    '',
    '=== 저장한 파편 전부 (`·무덤` = 흐려져서 가라앉은 것) ===',
    frags || '(없음)',
  ].join('\n');
}

// 질문 문장을 그대로 임베딩하면 검색이 망가진다 (2026-07-19 실측).
// "내가 홈레코딩 관련 저장한 거 있어? 링크도 줘"를 통째로 임베딩하면 "저장/링크" 같은
// 메타 표현이 벡터를 지배해서, 홈레코딩이 아니라 **앱의 링크·저장 기능에 대한 파편**이
// 상위에 온다(실측 1위 0.535 "링크 던지면 요약해서…"). 유저가 검색창에 "홈레코딩"만
// 치면 잘 나오던 이유가 이것이다 — 그래서 검색어를 질문에서 뽑아낸 뒤 검색한다.
// 아래 문구는 실측으로 조인 것이다 (2026-07-19). 동작어("정리","저장한 자료")가 주제어로
// 새어나오면 그 단어의 키워드 매치가 1.0점으로 상위를 먹어 검색이 다시 망가진다.
const EXTRACT_SYS = `사용자의 질문을 개인 메모 저장소 검색용으로 분해한다.
<최근대화>가 주어지면 그걸 맥락으로 읽는다.

topics — 검색할 주제어:
- 구체적인 소재·분야·고유명사만. 예: "홈레코딩", "기타", "카페 창업"
- ⚠️ **"그거/이거/저거/방금 그거/그 링크" 같은 지시어는 <최근대화>에서 실제 소재로 풀어서 넣어라.**
  예: 루디가 "케이스랩 메모"를 말한 뒤 "그거 찾아봐" → topics=["케이스랩"]. 지시어를 그대로 두지 마라.
- 다음은 절대 주제어가 아니다 — 버린다: 저장/기록/메모/정리/요약/링크/자료/목록,
  알려줘/보여줘/찾아줘, 최근/요즘/관심사/경향 같은 메타 표현
- 질문에 구체적 소재가 없으면(예: "요즘 뭐에 꽂혔어?") 빈 배열
- 1~3개, 짧은 명사구

type — 특정 종류만 찾는 질문이면 그 종류, 아니면 null:
- "링크/URL/사이트/영상 뭐 있지" → "link"
- "사진/이미지/캡쳐" → "image"
- "인용구/문장" → "quote"
- 종류를 안 가리면 null

period — **특정 기간에 저장한 것**을 묻는 질문이면 그 기간, 아니면 null:
- "오늘 뭐 저장했지", "오늘은 무슨 생각 했지" → "today"
- "어제 던진 거" → "yesterday"
- "이번 주", "지난주", "요 며칠" → "week"
- "이번 달", "최근 한 달" → "month"
- 기간을 안 가리키면 null. "요즘 뭐에 꽂혔어?"는 기간이 아니라 경향 질문이다 → null

intent — 이 메시지가 무엇인지:
- "trend": 최근 경향·관심사를 묻는 질문. "요즘 뭐에 꽂혔어?", "내 관심사가 뭐야"
- "orient": **오늘 뭘 보면/하면 좋을지 판단을 구하는 질문.** "오늘 뭐 봐야 할까", "오늘 뭐 하면
  좋을까", "놓치고 있는 거 있나", "내가 오늘 생각해야 할 거 있나". **어미가 핵심이다** —
  "-할까/-하면 좋을까/-있나"처럼 앞으로의 판단을 구하면 orient다.
  ⚠️ period와 헷갈리지 마라: "오늘 뭐 저장했지", "오늘은 무슨 생각을 했지"처럼 **과거형으로
  이미 한 일을 묻는 건 period다**(사실 조회). orient는 지금부터 뭘 볼지 판단을 구하는 것.
- "enumerate": **저장한 것들 중 "내가 ~한 것"을 전부 열거해달라는 질문.** 특정 소재가 아니라
  **태도·속성**으로 묶어서 묻는다. "내가 사고싶어한 것들이 뭐였지", "가보고 싶다던 데 어디였지",
  "내가 해보고 싶다고 한 것들", "내가 비판했던 것들", "읽으려고 저장한 거".
  판단 기준: **"내가 ~한/~하고 싶어한 것들"의 모양이면 enumerate다.** 태도의 종류는 상관없다 —
  구매·방문·시도·감상·비판 뭐든.
  ⚠️ period와 갈라라: period는 **시간**으로 자르고("오늘 뭐 저장했지"), enumerate는 **속성**으로
  자른다. 둘 다 있으면("지난주에 사고싶다고 한 거") period를 쓴다 — 시간이 더 좁은 조건이다.
  ⚠️ trend와 갈라라: trend는 "요즘 뭐에 꽂혔어"처럼 **경향**을 묻는다. enumerate는 항목을 달라는 것.
- "other": 그 외 전부. 구체적인 검색, 세상 지식 질문, 그리고 **질문이 아닌 것**
  (진술·감상·인사·잡담). 묻지 않았으면 trend·orient·enumerate가 아니다.

outward — 바깥(웹)에서 찾는 것과의 관계. **단, 이 사람의 세계(파편·프로젝트·관심)와 연결될 때만이다.**
루디는 만능 검색기가 아니다 — 날씨·환율·일반 사실 조회는 바깥이 아니다("no").
- "go": **명시적으로 바깥을 요청**했고 이 사람 맥락과 연결됨. "이런 거 찾아봐", "비슷한 프로덕트 찾아줘",
  "~ 사례 검색해줘", "그거 관련해서 바깥에 뭐 있나 찾아줘". 요청이 분명하면 바로 간다.
- "ask": 바깥이 **도움될 순 있지만 명시적으로 요청 안 함** (애매). "케이스랩 어때?", "이거 괜찮나?".
  → 마음대로 뒤지지 말고 물어본다.
- "no": 바깥 불필요. 저장소 질문, 순수 지식/개념, 잡담, 그리고 **이 사람 세계와 무관한 사실 조회
  (날씨·시세 등)**. 애매하면 no.

JSON만 출력: {"topics":["..."],"type":null,"period":null,"intent":"other","outward":"no"}`;

// more_like 모드 (파편 상세의 "more like this", 2026-07-31) — EXTRACT_SYS를 통째로 갈아끼운다.
//
// ⚠️ **질문 문구만 바꿔서는 안 막힌다. 검색어를 만드는 자리가 여기다.**
//    바깥(Exa)에 가는 건 topics인데, EXTRACT_SYS는 그걸 **저장소 검색용 소재어**로 뽑는다.
//    그래서 파편을 던지면 제품명이 그대로 Exa로 가고, findSimilar를 뺀 그 실패
//    (같은 물건 파는 다른 쇼핑몰·미러 사이트)가 그대로 재현된다.
// → 이름이 아니라 **종류**를 뽑게 한다. 발견의 `[아이디어]` 슬롯을 고친 2단계 분리와 같은 약.
// 호출 수는 안 는다 — 이미 도는 재작성 호출의 system만 바뀐다.
const MORE_LIKE_SYS = `사용자가 저장해둔 것 하나를 준다. 그것과 **같은 종류의 다른 것**을 바깥(웹)에서
찾기 위한 검색어를 만든다.

입력은 제목 한 줄이 아니라 파편 원본이다 — 제목 / 설명 / 내가 덧붙인 말이 온다.
- **설명이 종류를 정한다.** 제목은 낚시거나 은유일 수 있다. 실측: 유튜브 제목
  "Make anything sound cinematic"만 보고 "시네마틱 사운드 도구"로 잡았는데, 설명엔
  "effects pedal"이라고 적혀 있었다 — 하드웨어 페달을 두고 플러그인 쇼핑몰을 물어왔다.
- **덧붙인 말이 있으면 그게 각도다.** 이 사람이 왜 저장했는지가 거기 있다.
  그 각도로 종류를 좁혀라 (예: 덧이 "직접 만드는 판이 있다"면 완제품이 아니라 자작 쪽).

topics — 웹 검색어 1~3개:
- 먼저 이게 **어떤 종류의** 것인지 규정해라 (무슨 물건인지, 무슨 장르인지, 무슨 방식인지).
  그 다음 그 종류를 찾는 말로 쓴다.
- ⚠️ **소재의 이름·브랜드·모델명·제목·URL·사이트명을 검색어에 넣지 마라.**
  넣으면 같은 물건을 파는 다른 쇼핑몰과 미러 사이트만 돌아온다. 실측으로 확인된 실패다.
- 예: "Teenage Engineering OP-1" → ["휴대용 신디사이저", "포터블 샘플러"]
- 예: "무인양품 벽걸이 CD 플레이어" → ["미니멀 오디오 가전", "벽걸이형 스피커 디자인"]
- 예: "리액트 상태관리 라이브러리 비교 글" → ["프론트엔드 상태관리 비교", "상태관리 설계 패턴"]
- 종류를 못 정하겠으면 빈 배열. 억지로 이름을 넣지는 마라.

JSON만 출력: {"topics":["..."]}`;

const INTENTS = ['trend', 'orient', 'enumerate'];

type OutwardMode = 'no' | 'ask' | 'go';
type Extracted = {
  topics: string[];
  type: string | null;
  period: Period | null;
  intent: string;
  outward: OutwardMode;
};
const OUTWARD: OutwardMode[] = ['no', 'ask', 'go'];
const TYPES = ['text', 'link', 'image', 'quote'];
const PERIODS = ['today', 'yesterday', 'week', 'month'];

// recent = 최근 대화 몇 줄. "그거/이거" 같은 지시어를 여기서 실제 소재로 풀어야 검색이 조준된다.
// 이게 없어서 "오늘 뭐 남겼지 → 그거 찾아봐"의 '그거'가 헛돌았다 (2026-07-21 유저 지적).
//
// material — more_like일 때 종류를 뽑을 재료(파편 원본). 있으면 질문 문장 대신 이게 간다.
async function searchQueries(
  question: string,
  recent: string,
  material: string | null,
  onUsage?: UsageSink,
  meta?: Record<string, string>,
): Promise<Extracted> {
  const user = recent ? `<최근대화>\n${recent}\n</최근대화>\n\n질문: ${question}` : question;
  const raw = await complete(
    [
      { role: 'system', content: material ? MORE_LIKE_SYS : EXTRACT_SYS },
      { role: 'user', content: material ?? user },
    ],
    FAST_MODEL,
    onUsage,
    meta,
  );
  const p = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
  const topics = Array.isArray(p?.topics)
    ? p.topics.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 3)
    : [];
  // more_like는 칩 하나가 만든 고정 요청이다 — 갈래도 기간도 판정할 게 없고 바깥은 확정이다.
  if (material) {
    return { topics, type: null, period: null, intent: 'other', outward: 'go' };
  }
  return {
    topics,
    type: TYPES.includes(p?.type) ? p.type : null,
    period: PERIODS.includes(p?.period) ? (p.period as Period) : null,
    intent: INTENTS.includes(p?.intent) ? p.intent : 'other',
    outward: OUTWARD.includes(p?.outward) ? (p.outward as OutwardMode) : 'no',
  };
}

// 바깥(웹) 검색 결과를 모델에 넘길 블록. 채팅이 저장소를 넘어 바깥까지 뻗는 자리(§4-E 정신).
// 저장소 근거(<근거>)와 섞이지 않게 별도 블록으로 준다 — 출처 URL로 인용하게.
async function outwardBlock(queries: string[]): Promise<string> {
  const q = queries.join(' ').trim();
  if (!q) return '';
  const results = await exaSearch(q, 6);
  if (!results.length) return '';
  return results
    .map((r) => {
      const date = r.publishedDate?.slice(0, 10) ?? '';
      const hl = r.highlights.join(' … ').slice(0, 500);
      return `- ${r.title ?? '(제목없음)'}${date ? ` (${date})` : ''}\n  ${r.url}\n  ${hl}`;
    })
    .join('\n');
}

// 게이트 판정은 사유와 함께 남긴다 (§6-4). 실패해도 삼킨다 — 로그 때문에 채팅이 죽으면 본말전도.
// 기다리지도 않는다(fire-and-forget) — 로그가 첫 토큰을 늦출 이유가 없다.
function logGate(
  gate: string,
  passed: boolean,
  reason: string,
  detail: unknown,
  kind = 'resurface',
) {
  supabase
    .schema('rudy')
    .from('gate_log')
    .insert({ surface: 'chat', kind, gate, passed, reason, detail })
    .then(undefined, (e) => console.warn('[gate_log]', e));
}

// 클라이언트로는 NDJSON 한 줄씩 흘린다 — 청크 경계가 어디서 잘리든 줄 단위로 다시 맞춰진다.
const line = (o: unknown) => new TextEncoder().encode(`${JSON.stringify(o)}\n`);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // pinnedId = 파편 상세에서 물고 들어온 파편(§판 B). mode = 'more_like'면 검색어 프롬프트가 바뀐다.
  const { conversationId, question, pinnedId, mode } = await req.json();
  if (!conversationId || !question?.trim()) {
    return new Response(JSON.stringify({ error: 'conversationId·question 필요' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // 비용 추적 (2026-07-22) — 이 턴에서 도는 모든 gpt 호출(재작성·캡처판정·축라벨·본답변)을
  // 하나의 request_id로 묶는다. "각 응답마다 얼마" 표시의 원천.
  const cost = costTracker(supabase, { requestId: crypto.randomUUID(), conversationId });

  // 물고 있는 파편은 두 군데서 쓴다: more_like의 검색어 재료(바로 아래)와 <물고있는파편> 블록(맨 끝).
  // 한 번만 읽고 promise를 돌려 쓴다.
  const pinnedPromise: Promise<Frag | null> = pinnedId
    ? supabase
        .from('fragments')
        .select(FRAG_COLS)
        .eq('id', pinnedId)
        .single()
        .then(({ data }) => (data as Frag) ?? null, () => null)
    : Promise.resolve(null);

  // 이력은 질문과 무관하게 읽을 수 있다 — 임베딩·검색과 병렬로 (첫 토큰까지의 시간이 체감이다)
  const historyPromise = supabase
    .schema('rudy')
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  // 직전에 루디가 뭘 물었다면, 이 메시지가 그 답일 수 있다 (§4-F1).
  // 대기 중인 질문이 없으면 조회 한 번으로 끝나므로 매 턴 돌려도 싸다.
  // 검색과 병렬 — 캡처가 늦어져도 답변이 기다릴 이유가 없다.
  const capturePromise = captureAnswer(
    supabase,
    question,
    (g, p, r, d) => logGate(g, p, r, d, 'question'),
    cost.track('chat.question_judge', FAST_MODEL),
    cost.meta('chat.question_judge'),
  ).catch((e) => {
    console.warn('[chat] 자기 진술 캡처 실패', e);
    return null;
  });

  // 이력을 먼저 읽는다 — 검색어 추출이 "그거/이거"를 최근 대화에서 풀 수 있게(§유저 지적).
  // 답변에도 쓰이므로 여기서 한 번 await하고 재사용한다.
  const { data: history } = await historyPromise;
  const recent = ((history ?? []) as ChatMessage[])
    .slice(0, 4)
    .reverse()
    .map((m) => `${m.role === 'user' ? '나' : '루디'}: ${(m.content ?? '').replace(/\n/g, ' ').slice(0, 200)}`)
    .join('\n');

  // 검색어를 뽑는다. 실패하면 질문 그대로 — 재작성이 죽어도 채팅은 살아야 한다.
  //
  // more_like의 재료는 **질문 문장이 아니라 파편 원본**이다 (2026-08-02). 앱이 만든 문장엔
  // 제목 80자밖에 안 들어 있어서 설명·덧붙임에 있는 결정적 단서(무슨 물건인지, 왜 저장했는지)를
  // 통째로 버리고 있었다. 재료가 없으면(제목 미도착) 종류를 못 뽑으므로 바깥에 안 나간다.
  const moreLike = mode === 'more_like';
  const pinnedFrag = await pinnedPromise; // 위에서 이미 띄운 조회 (물고 온 게 없으면 즉시 null)
  const material = moreLike && pinnedFrag ? moreLikeMaterial(pinnedFrag) : null;
  const { topics, type, period, intent, outward } = moreLike && !material
    ? { topics: [] as string[], type: null, period: null, intent: 'other', outward: 'no' as OutwardMode }
    : await searchQueries(
        question,
        recent,
        material,
        cost.track('chat.rewrite', FAST_MODEL),
        cost.meta('chat.rewrite'),
      ).catch((e) => {
        console.warn('[chat] 질의 재작성 실패 → 질문 원문으로 검색', e);
        return { topics: [] as string[], type: null, period: null, intent: 'other', outward: 'no' as OutwardMode };
      });

  // 바깥 검색은 **명시적 요청(go)일 때만** 뻗는다 (§2-8 침묵 기본값 + 유저 통제). RAG와 병렬로.
  // 'ask'면 안 뒤지고 프롬프트가 "바깥에서 찾아볼까?"를 물어보게 한다. 실패해도 채팅은 산다.
  //
  // ⚠️ more_like는 질문 원문으로 폴백하지 않는다. 원문에 소재의 **이름**이 들어 있어서
  //    (칩이 파편 내용을 문장에 심는다) 그대로 Exa에 가면 MORE_LIKE_SYS로 막으려던 그 실패가
  //    뒷문으로 재현된다. 종류를 못 뽑았으면 바깥은 그냥 안 간다 (§2-8 침묵).
  const outwardQueries = topics.length ? topics : moreLike ? [] : [question];
  const outwardPromise: Promise<string> = outward === 'go' && outwardQueries.length
    ? outwardBlock(outwardQueries).catch((e) => {
        console.warn('[chat] 바깥 검색 실패 → 없이 진행', e);
        return '';
      })
    : Promise.resolve('');
  // 캡처를 먼저 끝낸다 — 방금 받아낸 자기 진술이 아래 축 계산에 반영되게.
  // 대기 중인 질문이 없으면 즉시 끝나므로 사실상 공짜다.
  const answered = await capturePromise;

  // ── 축 경로 (§10-6). 예전엔 여기서 질문 원문으로 검색했는데 그게 위에 적어둔 오염된
  // 경로라 아무거나 물어왔다. 이제 그 자리를 클러스터가 답한다.
  //
  // ⚠️ 조건이 `topics.length === 0`뿐이었는데 **그건 너무 넓었다** (2026-07-20 실사용).
  // 주제어가 안 나오는 건 메타 질문만이 아니다 — 진술·인사·잡담이 전부 빈 배열이다.
  // 늦은 의도 질문에 "그냥 재밌어보여서, 나 음악 했었어"라고 답한 걸 질문으로 착각해
  // **축 보고서를 또 냈다**(앞 턴과 거의 같은 답 = §2-2 위반).
  // → intent를 따로 뽑아 **셋 다 만족할 때만** 축으로 간다. 프록시 신호를 질문 판정에 쓰지 않는다.
  let axes: Axis[] = [];
  if (intent === 'trend' && !topics.length && !answered && !period) {
    try {
      axes = await findAxes(
        supabase,
        new Date(),
        cost.track('chat.axis_label', FAST_MODEL),
        cost.meta('chat.axis_label'),
      );
    } catch (e) {
      console.warn('[chat] 클러스터 실패 → 검색으로 폴백', e);
    }
    // 판정을 남긴다 (§6-4). 임계 0.42는 5일치 코퍼스로 정한 잠정값이라 며칠 뒤 이 로그로
    // 재조정한다 — 충돌 임계를 감으로 정했다가 뒤집은 것과 달리 이번엔 처음부터 근거가 쌓인다.
    logGate(
      'cluster',
      axes.length > 0,
      axes.length ? '축 성립' : '묶이는 축 없음 — 검색으로 폴백',
      {
        threshold: CLUSTER_MIN_SIM,
        axes: axes.map((a) => ({
          label: a.label,
          size: a.items.length,
          kind: a.kind,
          spanDays: Math.round(a.spanDays),
          activeDays: a.activeDays,
          quietDays: Math.round(a.quietDays),
        })),
      },
      'cluster',
    );
  }
  const useAxes = axes.length > 0;

  // ── orient 경로 (§10-9, 2026-07-22) — "오늘 뭐 봐야 할까" 류. period(사실 조회)와 다르다 —
  // 판단을 구하는 질문이라 저장소 전체에서 축×흐림 교집합을 본다. axes와 배타적(같은 intent 필드).
  let orient: OrientResult | null = null;
  if (intent === 'orient' && !topics.length && !answered && !period) {
    try {
      orient = await buildOrient(
        supabase,
        new Date(),
        cost.track('chat.orient', FAST_MODEL),
        cost.meta('chat.orient'),
      );
    } catch (e) {
      console.warn('[chat] orient 실패 → 근거 없이 진행', e);
    }
    logGate(
      'orient',
      !!orient,
      orient ? '볼 것 있음' : '볼 것 없음',
      { axisPicks: orient?.axisPicks.length ?? 0, projectPicks: orient?.projectPicks.length ?? 0 },
      'orient',
    );
  }

  // 주제어가 나오면 **그것만** 쓴다. 원문을 섞으면 메타 표현이 다시 검색을 오염시킨다
  // (실측: 원문을 섞으면 "링크 던지면 요약…"이 0.535로 1위, 빼면 "음성으로 녹음" 0.511이 1위).
  // 축이 안 서는 질문만 원문으로 검색해 폴백한다 — 채팅에서 침묵은 답이 아니다.
  const queries = topics.length ? topics : [question];

  // ── 열거 경로 (2026-07-25) — "내가 사고싶어한 것들이 뭐였지" 류.
  //
  // ⚠️ **속성 열거 질의는 검색으로 답할 수 없다.** period와 정확히 같은 종류의 한계다(아래
  //    시간 질의 주석 참고) — 시간이 아니라 **태도·속성**으로 자르는 질문이라서.
  //    실측(2026-07-25 유저 지적): "내가 사고싶어한 것들이 뭐였지"에 조명만 나왔다. 원인은
  //    topics가 안 뽑혀(구체적 소재가 없다) 질문 원문으로 검색했고, 그 임베딩에 남는 신호가
  //    "사고싶다"라는 **서술어뿐**이라 그 말이 문자로 적힌 파편만 걸린 것. 스피커 링크의
  //    임베딩은 "스피커 제품"이라 말하고, "사고 싶었다"는 저장할 때 아무도 안 적었다.
  //    → 튜닝으로 못 고친다. 인덱스에 그 정보가 없다.
  //
  // → 유사도를 아예 안 쓰고 **전 파편의 한 줄 요약을 전부** 넘긴다. 질문을 든 모델이 직접 고른다.
  //    이러면 사고싶다·하고싶다뿐 아니라 **어떤 속성이든** 잡힌다 — 미리 정의한 목록이 없으므로.
  //    (저장 시점에 stance 태그를 뽑아 인덱스하는 안은 기각했다: 유저 지적 "그 외에 다른 게
  //     나오면 어차피 못 잡는 거 아닌가" — 맞다. enum은 미리 예상한 속성만 잡는다.)
  const enumerateAll = intent === 'enumerate' && !answered && !period;

  let citedIds: string[] = [];
  let evidence = '';
  let periodNote = '';
  // 전량 블록은 **기본 갈래에서만** 붙인다. 나머지 갈래는 이미 자기 재료가 "전부"라서
  // (기간=그 기간 전부 / 열거=전 파편 / 축·오늘=계산된 것), 전량을 겹치면 모델이
  // 그 갈래의 규율을 무시하고 아무 날짜나 끌어온다 — prompt.ts §기간이 금지하는 그 동작.
  let corpus = '';

  if (period) {
    // ⚠️ 시간 질의는 **검색으로 답할 수 없다.** "오늘 뭐 저장했지"를 임베딩 유사도로
    // 처리하면 오늘 저장한 게 6개 있어도 질문 문장과 의미가 안 닿으면 안 나오고,
    // 모델은 태연히 "오늘 남긴 게 없네"라고 답한다 (2026-07-20 실사용에서 터짐).
    // 기간이 잡히면 유사도를 아예 안 쓰고 **그 기간에 저장된 것을 날짜로 전부 가져온다.**
    // 경계는 KST 자정 (_shared/time.ts) — UTC로 자르면 새벽에 하루가 밀린다.
    const { since, until } = kstRange(period);
    const { data: rows } = await supabase
      .from('fragments')
      .select(FRAG_COLS)
      .eq('archived', false)
      .gte('created_at', since)
      .lt('created_at', until)
      .order('created_at', { ascending: false })
      .limit(PERIOD_LIMIT);
    const inPeriod = (rows ?? []) as Frag[];
    citedIds = inPeriod.map((f) => f.id);
    evidence = inPeriod.map((f) => fragBlock(f, [])).join('\n');
    periodNote = `${PERIOD_LABEL[period]}(${since.slice(0, 10)} 이후) 저장한 파편 ${inPeriod.length}개 — 검색 결과가 아니라 전부다`;
  } else if (enumerateAll) {
    // archived(무덤)를 안 거른다 — "찾으러 온 행위는 무덤도 뒤진다"(rudy-search.sql:3) 계승.
    // 열거는 명시적으로 찾으러 온 것이라 검색과 같은 규칙을 따른다.
    const { data: rows } = await supabase
      .from('fragments')
      .select(FRAG_COLS)
      .order('created_at', { ascending: false })
      .limit(CORPUS_LIMIT);
    const all = (rows ?? []) as Frag[];
    evidence = all.map(enumLine).join('\n');
    periodNote = `저장한 파편 ${all.length}개 전부 — 검색 결과가 아니다`;
    // ⚠️ citedIds는 비운다. 300개를 근거 칩으로 그리면 답보다 칩이 길다 — 이 경로의 답은
    //    모델이 골라 본문에 링크로 건 목록 자체다(prompt.ts가 파편 링크를 의무화한다).
  } else if (intent === 'orient') {
    // orient는 검색으로 폴백하지 않는다 — "오늘 뭐 봐야 할까"는 메타 질문이라 원문으로
    // 검색하면 3차 사고(질문 문장이 메타 표현으로 검색을 오염시킴)가 재현된다.
    // 볼 게 없으면(orient===null) 근거 없이 진행 — 모델이 "지금은 딱히 없다"고 정직하게 말한다.
    if (orient) {
      citedIds = [
        ...orient.axisPicks.flatMap((a) => a.items.map((i) => i.id)),
        ...orient.projectPicks.flatMap((p) => p.items.map((i) => i.id)),
      ];
      evidence = orientBlock(orient);
    }
  } else if (useAxes) {
    // 축 자체가 근거다. 검색도, 자발적 연결도 안 돈다 — 이 답변은 이미 통째로
    // "묻지 않은 것을 꺼내는" 일이라, 거기 또 연결을 얹으면 같은 동작의 반복이다.
    citedIds = axes.flatMap((a) => a.items.map((f) => f.id));
    evidence = axesBlock(axes);
  } else {
    // ── 기본 갈래 (2026-07-29 개편). **재료가 둘이다:**
    //    ① <저장소> 전량 — "무엇이 있나". 모델이 331개를 직접 훑어 고른다.
    //    ② 유사도 상위 10개 — 그중 이 질문에 가장 닿는 것들의 **상세**(URL·설명·덧·프로젝트)
    //       + 근거 칩. 전량은 한 줄이라 URL도 프로젝트 소속도 없어서, 이게 없으면
    //       "링크 달라"·"프로젝트로 가자"가 답을 못 한다.
    //    검색을 없앤 게 아니라 **역할을 바꿨다** — 전엔 검색이 모델이 보는 전부였다.
    corpus = await corpusBlock();

    const embeds = await embedMany(queries);

    // 근거 검색 — 기존 하이브리드 RPC 그대로 쓴다 (검색과 채팅이 같은 랭킹을 봐야 말이 맞다).
    // 질의별로 돌리고 파편별 최고점으로 합친다.
    // type이 잡히면 그 종류만 (검색 UI의 타입 칩과 같은 동작).
    // "링크 뭐 있었지"에 링크 아닌 파편을 보여주면 답이 아니다.
    const runs = await Promise.all(
      queries.map((q, i) =>
        supabase.schema('rudy').rpc('search_fragments', {
          q_text: q,
          q_embed: embeds[i],
          match_count: CITE_COUNT,
          type_filter: type,
        }),
      ),
    );
    const failed = runs.find((r) => r.error);
    if (failed?.error) throw failed.error;

    const best = new Map<string, number>();
    for (const r of runs) {
      for (const h of (r.data ?? []) as { id: string; score: number }[]) {
        best.set(h.id, Math.max(best.get(h.id) ?? 0, h.score));
      }
    }
    citedIds = [...best.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CITE_COUNT)
      .map(([id]) => id);

    const { data: citedRows } = await supabase.from('fragments').select(FRAG_COLS).in('id', citedIds);
    // RPC의 점수 순서를 보존한다 — .in()은 순서를 보장하지 않는다
    const order = new Map(citedIds.map((id, i) => [id, i]));
    const cited = ((citedRows ?? []) as Frag[]).sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );

    // 근거 파편의 프로젝트 소속 — "프로젝트 상세로 가자"에 답할 재료.
    // description까지 가져온다 (2026-07-29) — 이름만으론 No phone이 뭔지 모른다.
    const projByFrag = new Map<string, Proj[]>();
    if (citedIds.length) {
      const { data: maps } = await supabase
        .from('fragment_projects')
        .select('fragment_id, projects(id, name, description)')
        .in('fragment_id', citedIds);
      for (const m of (maps ?? []) as { fragment_id: string; projects: Proj }[]) {
        if (!m.projects) continue;
        const arr = projByFrag.get(m.fragment_id) ?? [];
        arr.push(m.projects);
        projByFrag.set(m.fragment_id, arr);
      }
    }
    evidence = cited.map((f) => fragBlock(f, projByFrag.get(f.id) ?? [])).join('\n');
  }

  // ⚠️ 늦은 의도 질문(§4-F1)도 2026-08-01에 **껐다** — 유저: "이거 그냥 안 물어봐도 될 것 같은데 굳이?"
  //    답 끝에 "관심 있는 거 맞아?"가 붙는 게 대화를 늘어지게 했다. pickQuestion·logQuestion은
  //    intent.ts에 그대로 있다(되살리려면 여기서 다시 부르면 된다).
  //    captureAnswer는 남긴다 — 이미 물어놓고 답을 기다리는 질문이 24시간 안에 있을 수 있다.

  const web = await outwardPromise; // 바깥 검색 결과 (없으면 빈 문자열). history는 위에서 이미 읽음.

  // 물고 들어온 파편 (§판 B) — 유저가 "이걸 놓고 얘기하자"고 명시한 것이다. 검색 결과가 아니라서
  // <근거>에 섞지 않는다. 평소 갈래 판정에도 안 쓴다 — 여기 손대면 채팅 전체가 흔들린다.
  // (예외는 more_like 하나. 거긴 이 파편이 곧 질문이라 검색어를 여기서 뽑는다 — 위 참조.)
  const pinnedBlock = pinnedFrag ? fragBlock(pinnedFrag, []) : '';

  // ⚠️ UTC가 아니라 KST 기준 오늘. UTC로 넣으면 KST 새벽에 루디가 어제를 오늘로 안다.
  const today = kstToday();
  const context = [
    period
      ? `<기간>\n${periodNote}\n${evidence || '(이 기간에 저장한 것 없음)'}\n</기간>`
      : enumerateAll
        ? `<전체목록>\n${periodNote}\n${evidence || '(저장한 것 없음)'}\n</전체목록>`
        : intent === 'orient'
          ? `<오늘>\n${orient ? evidence : '오늘 딱히 다시 볼 만한 게 없다.'}\n</오늘>`
          : useAxes
            ? `<축>\n${evidence}\n</축>`
            : `<근거>\n${evidence || '(없음)'}\n</근거>`,
    pinnedBlock ? `<물고있는파편>\n${pinnedBlock}\n</물고있는파편>` : '',
    web ? `<바깥>\n${web}\n</바깥>` : '',
    // 'ask' = 바깥이 도움될 수 있지만 안 뒤졌다. 억지 말고 도움되면 끝에 "바깥에서 찾아볼까?" 묻게.
    outward === 'ask' ? `<바깥가능>\n바깥에서 찾으면 도움될 수 있다. 억지로 말고, 정말 도움되겠으면 답 끝에 짧게 "바깥에서 찾아볼까?"라고만 물어라.\n</바깥가능>` : '',
    answered ? `<방금답함>\n${questionSubject(answered)}\n</방금답함>` : '',
    question,
  ]
    .filter(Boolean)
    .join('\n\n');

  // ⚠️ 전량 블록은 **system 바로 뒤**여야 한다 (2026-07-29). OpenAI 자동 캐싱은 프롬프트
  //    앞에서부터 같은 부분만 걸리는데, 이력 뒤에 두면 이력이 매 턴 바뀌어 24k짜리 재료가
  //    영영 캐시에 안 올라간다. 여기 두면 한 대화의 2번째 턴부터 캐시 입력 단가($0.50/1M =
  //    1/10)로 떨어진다.
  //    RUDY-STATUS 기각 목록의 "캐싱은 안 걸린다"는 **하루 1회 브리핑** 얘기다 — 채팅은
  //    턴이 몇 분 간격이라 조건이 정반대고, 그래서 여기선 되살렸다.
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(today) },
    ...(corpus ? [{ role: 'system' as const, content: `<저장소>\n${corpus}\n</저장소>` }] : []),
    ...((history ?? []).reverse() as ChatMessage[]), // 최신순으로 받아 시간순으로 되돌린다
    { role: 'user', content: context },
  ];

  // 원장(rudy.utterances)에 이 턴이 적는 것은 이제 없다. 채팅이 원장에 남기던 두 가지가
  // 자발적 연결(resurface)과 늦은 의도(question)였는데 둘 다 껐다 — 위 주석 참고.
  // 평범한 채팅 답변은 원래도 안 적는다: 원장은 §2-2 "먼저 거는 말"의 중복 방지 장치라,
  // 질문에 답한 걸 전부 넣으면 반복 게이트가 오염된다.

  // 클라이언트가 중단(■)하면 cancel이 불린다 — 그만 만들고, 받은 데까지 저장한다.
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      // 클라이언트가 끊긴 뒤의 enqueue는 던진다 — 삼키고 저장 경로로 간다
      const push = (o: unknown) => {
        try {
          controller.enqueue(line(o));
        } catch {
          cancelled = true;
        }
      };

      let answer = '';
      try {
        // 근거를 먼저 흘린다 — 저장이 실패해도 앱이 근거 칩을 그릴 수 있어야 한다.
        // 모델이 링크를 안 걸어도 이 칩이 있으면 검색과 같은 수준으로 결과가 보인다.
        if (outward === 'go') push({ t: 'web' }); // 바깥을 뒤졌다 — 앱이 "바깥에서 찾아봤다"를 표시
        push({ t: 'cite', ids: citedIds });
        // 'link' 이벤트(자발적 연결)는 더 안 나간다 — 앱의 수신부는 남아 있다(되살릴 때를 위해).
        for await (const delta of chatStream(
          messages,
          CHAT_MODEL,
          cost.track('chat.answer', CHAT_MODEL),
          cost.meta('chat.answer'),
        )) {
          if (cancelled) break; // 중단 — OpenAI 스트림도 여기서 놓는다
          answer += delta;
          push({ t: 'd', c: delta });
        }
      } catch (e) {
        console.error('[chat]', e);
        push({ t: 'error', message: String(e) });
      } finally {
        // 이력은 서버가 적는다 — 앱이 스트리밍 중에 죽거나 중단해도 받은 데까지 남는다.
        if (answer) {
          const { usd: costUsd } = cost.result(); // 이 턴에 쓴 gpt 호출 전부(재작성·판정·라벨·답변) 합계
          const { error } = await supabase
            .schema('rudy')
            .from('messages')
            .insert([
              // ⚠️ cited_ids를 명시해야 한다. PostgREST 다중 행 insert는 행마다 키가 다르면
              // 빠진 키를 default가 아니라 null로 채운다 — not null 제약에 걸려 저장 전체가
              // 죽었고, 그게 "다음 전송 잠김"의 뿌리였다 (2026-07-19 실측, 23502).
              { conversation_id: conversationId, role: 'user', content: question, cited_ids: [] },
              {
                conversation_id: conversationId,
                role: 'assistant',
                content: answer,
                cited_ids: citedIds,
                cost_usd: costUsd,
              },
            ]);
          if (error) console.warn('[chat] 이력 저장 실패', error);

          // 대화 이름은 첫 질문이다. 요약 모델을 부르지 않는다 — 목록에서 알아보는 게 목적이지
          // 잘 지은 제목이 목적이 아니다. 이미 이름이 있으면 건드리지 않는다.
          await supabase
            .schema('rudy')
            .from('conversations')
            .update({ title: question.slice(0, 60) })
            .eq('id', conversationId)
            .is('title', null)
            .then(undefined, (e) => console.warn('[chat] 제목 저장 실패', e));

          // ⚠️ 저장이 끝난 뒤에 보낸다. 앱은 이 신호를 보고서야 화면의 답을 지운다 —
          // 스트림이 닫혔다는 것만으로 지우면 아직 안 적힌 답을 못 찾고 증발시킨다.
          push({ t: 'done', saved: !error, costUsd });
        }
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 */
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: { ...cors, 'Content-Type': 'application/x-ndjson' },
  });
});
