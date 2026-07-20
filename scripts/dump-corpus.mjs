// 진단용(일회성): 브리핑 재료를 성격별로 눈으로 보려고 코퍼스를 덤프한다. 앱 런타임과 무관.
//   node scripts/dump-corpus.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const kst = (iso) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

const { data: projects } = await supabase
  .from('projects')
  .select('id, name, status, started_at, description')
  .order('created_at');

const { data: frags } = await supabase
  .from('fragments')
  .select('id, created_at, type, content, link_title, link_description, note, touch_count, archived, fragment_projects(project_id)')
  .eq('archived', false)
  .order('created_at', { ascending: false });

const projName = new Map(projects.map((p) => [p.id, p.name]));

console.log('===== PROJECTS =====');
for (const p of projects) {
  const n = frags.filter((f) => f.fragment_projects.some((x) => x.project_id === p.id)).length;
  console.log(`\n[${p.name}] status=${p.status} started=${p.started_at ?? '-'} frags=${n}`);
  console.log(`  desc: ${p.description ?? '(없음)'}`);
}

console.log(`\n\n===== FRAGMENTS (살아있음 ${frags.length}개, 최신순) =====`);
for (const f of frags) {
  const projs = f.fragment_projects.map((x) => projName.get(x.project_id) ?? '?').join(',') || 'Inbox';
  const title = f.type === 'link' ? (f.link_title ?? '') : '';
  let body = (f.content ?? '').replace(/\s+/g, ' ').trim();
  if (body.length > 200) body = body.slice(0, 200) + '…';
  const desc = f.link_description ? ` | ogdesc: ${f.link_description.replace(/\s+/g, ' ').slice(0, 160)}` : '';
  const note = f.note ? ` | note: ${f.note.replace(/\s+/g, ' ')}` : '';
  const t = f.touch_count ? ` t${f.touch_count}` : '';
  console.log(`${kst(f.created_at)} [${f.type}]${t} <${projs}> ${title ? `『${title}』 ` : ''}${body}${desc}${note}`);
}
