// 질문/검색어를 임베딩해 { embedding } 반환 (RUDY-BUILD.md Phase 0.5 · A-2).
// 앱에 OpenAI 키가 없으므로 검색·채팅은 이 함수를 거쳐 질문을 임베딩한다.

import { embed } from '../_shared/openai.ts';

// react-native-web 타깃에서 브라우저가 호출하면 CORS preflight가 뜬다.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { text } = await req.json();
  if (!text || typeof text !== 'string') return json({ error: 'no text' }, 400);
  const embedding = await embed(text);
  return json({ embedding });
});
