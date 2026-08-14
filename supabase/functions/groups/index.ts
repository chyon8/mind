// 헤매기 안 "무리" — 살아있는 파편을 유사도로 묶어 보여준다. 이름은 안 붙인다.
// (2026-08-12, 유저 요청: "묻어져있는건 분류안하는거 알지" / 폰에서 버튼 하나로 보이게)
//
// LLM을 안 쓴다 — 임베딩(embed 웹훅이 자동으로 만든다)에 평균연결만 돌린다. 그래서 아침·발견과
// 달리 맥에서 클로드 코드로 미리 만들 필요가 없다. 무리는 저장하지 않는다 (§2-1 규정 금지).
//
// ⚠️ **DBSCAN을 쓰지 마라.** 2026-08-12에 UMAP 5D + DBSCAN으로 만들었다가 유저가 잡아냈다 —
//    "떠다니는 생각 파편 시각화"에 "독서모임"과 "여름이 가는걸 아쉬워하는 여자"가 한 무리로 붙었다.
//    실측: 그 무리의 원본 코사인 평균 0.239 / 최저쌍 0.081인데 **전체 중앙값이 0.188**이었다.
//    무작위나 다름없었다는 뜻이다. 원인은 DBSCAN이 밀도로 이어붙이는 체이닝 알고리즘이라는 것 —
//    `_shared/cluster.ts`가 이미 같은 이유로 단일연결을 버리고 평균연결을 골랐는데 그 교훈을 무시했다.
//    같은 재료를 평균연결로 묶으면 약한 무리가 0개가 되고 최저쌍이 0.081 → 0.292로 올라간다.
//
// ⚠️ **UMAP도 뺐다.** 체이닝을 고치고 나니 투영이 하는 일이 없었다 — 커버리지만 늘리고
//    정밀도를 깎았다(71% 커버 대신 47%지만 약한 무리 0개). 덤으로 세 가지가 따라온다:
//    ① 매번 같은 결과가 나온다(UMAP은 난수 시드를 타서 "다시"를 누를 때마다 무리가 바뀌었다)
//    ② 3072차원 벡터를 Deno로 안 끌어와도 된다 — 쌍 비교가 SQL에 남는다(cluster_edges와 같은 이유)
//    ③ npm 의존성이 사라진다

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { cluster, type Edge } from '../_shared/cluster.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// 실측(2026-08-12, 살아있는 66개): 0.33에서 무리 6개·커버 47%·약한 무리 0개·최저쌍 0.292.
// 0.30으로 낮추면 커버는 50%로 거의 안 오르는데 서로 다른 주제 둘이 한 덩어리가 된다(14개짜리).
// 코퍼스가 자라면 재실측할 것 — 지금 코퍼스가 어리다.
const MIN_SIM = 0.33;
// ⚠️ cluster.ts의 기본값은 3인데 여기선 **2로 내린다.** "2개짜리는 축이 아니라 그냥 닮은 둘"은
// 브리핑 축 규칙이다 — 거긴 패턴을 말해야 하니 둘로는 부족하다. 무리는 훑어보는 화면이라
// 닮은 둘도 볼 값이 있다. 실측(2026-08-12): 3에서 안 묶인 35개 중 **27개가 0.33 이상인 짝을
// 갖고 있었다.** 2로 내리면 커버 42%→66%, 무리 6→15개, 약한 무리는 그대로 0개다.
const MIN_SIZE = 2;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // 헤매기에서 길게 눌러 빼둔 프로젝트를 무리에서도 뺀다 (앱에서 옵션을 켰을 때만 온다).
  // **묶기 전에 뺀다** — 묶고 나서 멤버만 지우면 남은 것들이 실제로 서로 묶이는지 알 수 없고
  // 대표(medoid)도 사라질 수 있다.
  let excludeProjects: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.excludeProjects)) excludeProjects = body.excludeProjects;
  } catch {
    // 본문 없음 = 전부 묶는다 (예전 동작)
  }

  // 살아있는 파편 전체 — 무리에 못 든 것도 "안 묶인 것"으로 보여줘야 하므로 목록이 필요하다.
  const { data: alive, error: fErr } = await supabase
    .from('fragments')
    .select('id')
    .eq('archived', false)
    .is('let_go_at', null);
  if (fErr) return json({ error: fErr.message }, 500);
  let aliveIds = (alive ?? []).map((f) => f.id as string);

  let dropped = new Set<string>();
  if (excludeProjects.length > 0) {
    const { data: rows, error: pErr } = await supabase
      .from('fragment_projects')
      .select('fragment_id')
      .in('project_id', excludeProjects);
    if (pErr) return json({ error: pErr.message }, 500);
    dropped = new Set((rows ?? []).map((r) => r.fragment_id as string));
    aliveIds = aliveIds.filter((id) => !dropped.has(id));
  }

  // 쌍 비교는 SQL에 맡긴다 — 벡터가 3072차원이라 Deno로 끌어오면 전송량이 수십 MB가 된다.
  const { data: edgeRows, error: eErr } = await supabase
    .schema('rudy')
    .rpc('group_edges', { min_sim: MIN_SIM });
  if (eErr) return json({ error: eErr.message }, 500);

  const edges = ((edgeRows ?? []) as Edge[]).filter(
    (e) => !dropped.has(e.a) && !dropped.has(e.b),
  );
  const raw = cluster(edges, MIN_SIM, MIN_SIZE).sort((x, y) => y.length - x.length);

  // 대표 = 무리 안에서 나머지와의 유사도 합이 가장 큰 파편(medoid). **분류에는 아무 영향이 없다** —
  // 묶기가 끝난 뒤에 접힌 목록의 머리글로 뭘 보여줄지만 정한다.
  // 중요도(pinned/important)는 안 쓴다: 43무리 비교에서 무승부였고, 중요 파편이 무리 가장자리에
  // 있을 때 대표가 무리를 설명 못 하는 사고가 났다 (2026-08-12).
  const groups = raw.map((memberIds) => {
    const inGroup = new Set(memberIds);
    const score = new Map(memberIds.map((id) => [id, 0]));
    for (const e of edges) {
      if (!inGroup.has(e.a) || !inGroup.has(e.b)) continue;
      score.set(e.a, score.get(e.a)! + e.similarity);
      score.set(e.b, score.get(e.b)! + e.similarity);
    }
    const repId = memberIds.reduce((best, id) => (score.get(id)! > score.get(best)! ? id : best));
    return { repId, memberIds };
  });

  const clustered = new Set(raw.flat());
  const noiseIds = aliveIds.filter((id) => !clustered.has(id));

  return json({ groups, noiseIds });
});
