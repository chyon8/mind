// 의도로 묶기 (2026-08-22 유저 지시). 임베딩 묶기를 대체한다.
//
// 왜 바꿨나 — 실측(2026-08-22, 살아있는 파편 119개): 임계값을 0.28~0.40으로 훑어도
// **2개짜리 무리 비율이 58~67%에서 안 움직이고 최대 무리도 6~11에서 안 컸다.**
// 유저 판정: "두개씩 묶여있고 이건 좀 에바같애. 의미가 없잖아 아예." 숫자 튜닝은 막다른 길이었다.
// 임베딩은 **말이 비슷한 것**을 묶는다. 벳푸 온천·해외 살기·을지로 술집은 벡터상 남남이지만
// "여기 말고 다른 데서 살아보고 싶다"는 하나다. 그건 코사인이 원리상 못 보는 것이다.
//
// ⚠️ RUDY-STATUS의 "묶기가 다시 나오면 cluster.ts를 재사용해라"는 **비슷한 것끼리 묶기**에
//    거는 교훈이다(DBSCAN 체이닝 사고). 여기는 다른 문제라 안 쓴다 — 대신 그때 배운 것을
//    그대로 가져온다: **억지로 붙이느니 안 묶는 게 낫다.** 아래 규칙 ③이 그 자리다.
//
// ⚠️ 결과는 아무데도 저장하지 않는다 (SPEC §2-1 규정 금지). 누를 때 묶고, 보여주고, 버린다.

import { complete, DISCOVERY_MODEL, type UsageSink } from '../_shared/openai.ts';

export type Frag = {
  id: string;
  type: string;
  content: string;
  link_title: string | null;
  link_description: string | null;
  note: string | null;
};

export type IntentGroup = { label: string; memberIds: string[] };

// 파편 하나 = 한 줄. 번호로 주고 번호로 받는다 — uuid를 출력시키면 출력 토큰이 몇 배가 되고
// 모델이 한 글자씩 틀린다.
export function fragLine(f: Frag, n: number): string {
  const title = (f.type === 'link' ? (f.link_title ?? f.content) : f.content ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  const desc = f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 100)}` : '';
  const note = f.note ? ` (덧: ${f.note.replace(/\s+/g, ' ').slice(0, 80)})` : '';
  return `#${n} ${title}${desc}${note}`;
}

export const GROUP_SYS = `이 사람이 저장해둔 생각 파편들을 묶어라.

## 무엇으로 묶나

**"왜 이걸 저장했나"가 같으면 한 무리다.** 소재나 단어가 달라도 된다.

말이 비슷한 것끼리 묶는 건 이미 기계가 해봤고 실패했다 — 2개씩 서른 덩어리가 나왔고
유저가 "의미가 없잖아"라고 했다. 네가 할 일은 그게 못 보는 것을 보는 거다.

- ○ "벳푸 온천 貸間" + "해외 살기 해야돼" + "피즈소셜클럽 을지로" → 여기 말고 딴 데서 살아보기
- ○ "Sensor tower 매출 보기" + "500명만 구독해도 월 5000달러" + "OpenCut" → 혼자 만들어 돈 벌기
- ✗ "기타 이펙터" + "기타 코드" → 단어만 같다. 이건 기계도 한다.

## 규칙

① **무리 하나에 최소 3개.** 2개짜리는 무리가 아니라 그냥 닮은 둘이다. 그래서 이걸 새로 만든다.
② **전체 무리 5~12개.** 그보다 많으면 잘게 쪼갠 거다 — 합칠 수 있는지 다시 봐라.
③ **안 묶이는 건 안 묶는다.** 억지로 끼워넣지 마라. 남는 건 남는 대로 둔다.
   억지 무리 하나가 나머지 전부의 신뢰를 깎는다. 무리에 안 들어간 번호는 알아서 처리되니
   출력에 적지 마라.
④ **한 파편은 한 무리에만.** 두 군데 걸치면 더 강한 쪽 하나만 고른다.

## 이름

무리를 여는 접힌 목록의 머리글이다. 이름만 보고 안에 뭐가 있을지 알아야 한다.

- 4~12글자. 명사구. **띄어쓰기를 붙이지 마라** ("Focusdesk" ✗ / "Focus desk" ○).
- **사람을 규정하지 마라.** "음악 애호가" ✗ / "신디사이저" ○
- **추상적인 상위 개념 금지.** "창작 활동" "자기계발" "라이프스타일" 같은 건 아무것도 안 알려준다.
- 무리 안에서 실제로 오간 말을 써라. 없는 단어를 만들지 마라.

## 출력

JSON만. 다른 말 없이.

{"groups":[{"label":"이름","members":[3,17,42]}]}

members는 준 번호 그대로. 없는 번호를 쓰지 마라.`;

// 번호 → id 복원. 모델이 없는 번호·중복을 뱉는 걸 여기서 막는다 (프롬프트로 막지 않는다 —
// 파서가 견뎌야 한다는 교훈, RUDY-STATUS).
export function parseGroups(raw: string, ids: string[]): IntentGroup[] {
  const json = raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  const parsed = JSON.parse(json) as { groups?: { label?: string; members?: number[] }[] };
  const used = new Set<number>();
  const out: IntentGroup[] = [];
  for (const g of parsed.groups ?? []) {
    const label = (g.label ?? '').trim();
    const nums = (g.members ?? []).filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= ids.length && !used.has(n),
    );
    for (const n of nums) used.add(n);
    // ①을 코드로도 건다 — 프롬프트가 지켜주길 기대하지 않는다
    if (!label || nums.length < 3) continue;
    out.push({ label, memberIds: nums.map((n) => ids[n - 1]) });
  }
  return out.sort((a, b) => b.memberIds.length - a.memberIds.length);
}

export async function groupByIntent(
  frags: Frag[],
  model = DISCOVERY_MODEL,
  onUsage?: UsageSink,
  meta?: Record<string, string>,
): Promise<IntentGroup[]> {
  if (frags.length < 3) return [];
  const block = frags.map((f, i) => fragLine(f, i + 1)).join('\n');
  const raw = await complete(
    [
      { role: 'system', content: GROUP_SYS },
      { role: 'user', content: block },
    ],
    model,
    onUsage,
    meta,
    // 실측(2026-08-22): 기본 추론량은 83초·출력 5,802토큰인데 low는 5.7초·355토큰에
    // 무리가 더 고르게 나온다(최대 25개 → 16개). 묶는 건 판단이지 긴 사고가 아니다.
    'low',
  );
  return parseGroups(raw, frags.map((f) => f.id));
}
