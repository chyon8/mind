// 묶기(의도 기반)를 앱 없이 돌려보고 눈으로 판정한다 (2026-08-22).
//   node scripts/check-groups.mjs                ← 기본 모델(gpt-5.5)
//   node scripts/check-groups.mjs gpt-4o         ← 모델 비교
//
// 프롬프트는 supabase/functions/groups/intent.ts에서 **직접 읽는다** — 복제하면 갈라진다
// (_discovery-lib.mjs가 복제라서 갈라질 위험을 안고 있는 것과 반대로 간다).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const KEY = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI_API_KEY;
const MODEL = process.argv[2] ?? 'gpt-5.5';
const EFFORT = process.argv[3]; // gpt-5 계열: minimal|low|medium|high (지연이 여기서 갈린다)
const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// intent.ts에서 프롬프트와 줄 포맷을 뽑아온다
const src = readFileSync(new URL('../supabase/functions/groups/intent.ts', import.meta.url), 'utf8');
const GROUP_SYS = src.match(/export const GROUP_SYS = `([\s\S]*?)`;/)[1].replace(/\\`/g, '`');

const fragLine = (f, n) => {
  const title = (f.type === 'link' ? (f.link_title ?? f.content) : f.content ?? '').replace(/\s+/g, ' ').slice(0, 120);
  const desc = f.link_description ? ` — ${f.link_description.replace(/\s+/g, ' ').slice(0, 100)}` : '';
  const note = f.note ? ` (덧: ${f.note.replace(/\s+/g, ' ').slice(0, 80)})` : '';
  return `#${n} ${title}${desc}${note}`;
};

const { data: frags, error } = await supabase
  .from('fragments')
  .select('id, type, content, link_title, link_description, note')
  .eq('archived', false)
  .order('created_at', { ascending: false });
if (error) { console.error(error); process.exit(1); }

const block = frags.map((f, i) => fragLine(f, i + 1)).join('\n');
const t0 = Date.now();
console.log(`모델 ${MODEL}${EFFORT ? ` (effort ${EFFORT})` : ''} / 살아있는 파편 ${frags.length}개 / 재료 ${block.length}자 (≈${Math.round(block.length / 2.2)}토큰)\n`);

const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'system', content: GROUP_SYS }, { role: 'user', content: block }],
    ...(MODEL.startsWith('gpt-5') ? (EFFORT ? { reasoning_effort: EFFORT } : {}) : { temperature: 0 }),
  }),
});
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const { choices, usage } = await res.json();
const raw = choices[0].message.content.trim();

let parsed;
try {
  parsed = JSON.parse(raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim());
} catch { console.error('JSON 파싱 실패:\n', raw); process.exit(1); }

const used = new Set();
let dropped = 0;
const groups = [];
for (const g of parsed.groups ?? []) {
  const nums = (g.members ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= frags.length && !used.has(n));
  for (const n of nums) used.add(n);
  if (!g.label?.trim() || nums.length < 3) { dropped++; continue; }
  groups.push({ label: g.label.trim(), nums });
}
groups.sort((a, b) => b.nums.length - a.nums.length);

for (const g of groups) {
  console.log(`\n■ ${g.label}  (${g.nums.length}개)`);
  for (const n of g.nums) console.log('   ', fragLine(frags[n - 1], n).slice(0, 100));
}
const cov = groups.reduce((s, g) => s + g.nums.length, 0);
console.log(`\n${'─'.repeat(60)}`);
console.log(`무리 ${groups.length}개 (파서가 버린 것 ${dropped}개) / 커버 ${cov}/${frags.length} (${Math.round(cov / frags.length * 100)}%)`);
console.log(`크기분포 [${groups.map((g) => g.nums.length).join(',')}]`);
console.log(`토큰 in ${usage.prompt_tokens} / out ${usage.completion_tokens} / 소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
