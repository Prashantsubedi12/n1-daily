#!/usr/bin/env node
// Reads the learner's synced attempts (progress branch) and prints a weakness report
// that the daily generator uses to decide what to write next.
//
// Usage:
//   git fetch origin progress
//   node tools/analyze.mjs                 # reads progress files from origin/progress
//   node tools/analyze.mjs --dir path/     # or from a local folder of progress JSON files
//   node tools/analyze.mjs --json          # machine-readable output

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const ref = opt('--ref') || 'origin/progress';
const dir = opt('--dir');
const asJSON = args.includes('--json');

// ---- load questions ----
const index = JSON.parse(readFileSync(join(ROOT, 'data/index.json'), 'utf8'));
const files = [...(index.bank || []), ...(index.daily || []).map(d => `daily/${d}.json`)];
const Q = {};
const P = {};
const tagCount = {};
for (const f of files) {
  const doc = JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
  for (const p of doc.passages || []) P[p.id] = p;
  for (const q of doc.questions || []) {
    Q[q.id] = { ...q, date: doc.date || null };
    for (const t of q.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
  }
}

// ---- load attempts ----
function progressDocs() {
  if (dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  try {
    const names = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'progress/'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(n => n.endsWith('.json'));
    return names.map(n => JSON.parse(execFileSync('git', ['show', `${ref}:${n}`], { cwd: ROOT, encoding: 'utf8' })));
  } catch (e) {
    console.error(`Could not read ${ref} (run: git fetch origin progress). ${e.message.split('\n')[0]}`);
    return [];
  }
}

const attempts = progressDocs()
  .flatMap(d => d.attempts || [])
  .filter(a => !a.rt)
  .sort((a, b) => a.t - b.t);

const SEC = { reading: 'read', listening: 'listen' };
const secOf = q => SEC[q.type] || 'lang';
const today = new Date();
const dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = n => dstr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));

function agg(since) {
  const out = { sec: {}, type: {}, sub: {}, tag: {}, n: 0, c: 0, lucky: 0 };
  const bump = (o, k, g) => {
    const a = (o[k] ||= { n: 0, c: 0 });
    a.n++;
    if (g) a.c++;
  };
  for (const a of attempts) {
    if (a.d < since) continue;
    const q = Q[a.id];
    if (!q) continue;
    const good = a.ok && !a.lk;
    out.n++;
    if (good) out.c++;
    if (a.lk) out.lucky++;
    bump(out.sec, secOf(q), good);
    bump(out.type, q.type, good);
    if (q.sub) bump(out.sub, `${q.type}:${q.sub}`, good);
    for (const t of q.tags || []) bump(out.tag, t, good);
  }
  return out;
}

const all = agg('0000');
const last7 = agg(daysAgo(6));
const last14 = agg(daysAgo(13));

const perDay = {};
for (const a of attempts) {
  const p = (perDay[a.d] ||= { n: 0, c: 0 });
  p.n++;
  if (a.ok && !a.lk) p.c++;
}

const weakTags = Object.entries(last14.tag)
  .filter(([, a]) => a.n >= 1 && a.c < a.n)
  .map(([tag, a]) => ({ tag, n: a.n, c: a.c, miss: a.n - a.c, rate: +(a.c / a.n).toFixed(2), bankQuestions: tagCount[tag] || 0 }))
  .sort((x, y) => x.rate - y.rate || y.miss - x.miss)
  .slice(0, 30);

const recentMistakes = attempts
  .filter(a => a.d >= daysAgo(2) && (!a.ok || a.lk) && Q[a.id])
  .slice(-60)
  .map(a => {
    const q = Q[a.id];
    return {
      id: q.id,
      type: q.type,
      sub: q.sub || null,
      tags: q.tags,
      q: q.q || q.ask || null,
      passage: q.passage ? (P[q.passage]?.title || q.passage) : null,
      chose: a.lk ? '(correct but marked lucky)' : q.choices[a.ch],
      correct: q.choices[q.answer],
      seconds: Math.round(a.ms / 1000),
    };
  });

const speed = {};
for (const a of attempts) {
  if (!a.pt || a.d < daysAgo(13)) continue;
  const q = Q[a.id];
  const p = q && P[q.passage];
  if (!p) continue;
  const s = (speed[p.kind] ||= { passages: 0, ms: 0, targetMs: 0, chars: 0 });
  s.passages++;
  s.ms += a.pt;
  s.targetMs += p.target * 1000;
  s.chars += p.text.length;
}
for (const s of Object.values(speed)) {
  s.charsPerMin = Math.round(s.chars / (s.ms / 60000));
  s.vsTarget = +(s.ms / s.targetMs).toFixed(2);
}

const seen = new Set(attempts.map(a => a.id));
const unseen = {};
for (const q of Object.values(Q)) {
  if (seen.has(q.id)) continue;
  const k = q.sub ? `${q.type}:${q.sub}` : q.type;
  unseen[k] = (unseen[k] || 0) + 1;
}

const latestDaily = (index.daily || []).slice(-1)[0] || null;
let latestDailyUsage = null;
if (latestDaily) {
  const ids = Object.values(Q).filter(q => q.date === latestDaily).map(q => q.id);
  const done = ids.filter(id => seen.has(id)).length;
  latestDailyUsage = { date: latestDaily, questions: ids.length, attempted: done };
}

const rate = a => (a && a.n ? `${Math.round((a.c / a.n) * 100)}% (${a.c}/${a.n})` : '—');
const report = {
  generated: new Date().toISOString(),
  totalAttempts: all.n,
  daysStudied: Object.keys(perDay).length,
  lastStudyDay: attempts.length ? attempts[attempts.length - 1].d : null,
  perDayLast7: Object.fromEntries(Object.entries(perDay).filter(([d]) => d >= daysAgo(6))),
  accuracy: { allTime: all, last7, last14: { sec: last14.sec, type: last14.type, sub: last14.sub, n: last14.n, c: last14.c } },
  weakTags,
  recentMistakes,
  readingSpeed: speed,
  unseenInBank: unseen,
  latestDailyUsage,
};

if (asJSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const lines = [];
lines.push(`# Learner report — ${dstr(today)}`);
lines.push(`Attempts: ${all.n} total · ${report.daysStudied} day(s) studied · last study day: ${report.lastStudyDay || 'none yet'}`);
if (latestDailyUsage) lines.push(`Latest daily file ${latestDailyUsage.date}: ${latestDailyUsage.attempted}/${latestDailyUsage.questions} questions attempted`);
lines.push('', '## Per day (last 7)');
for (const [d, a] of Object.entries(report.perDayLast7)) lines.push(`- ${d}: ${rate(a)}`);
lines.push('', '## Accuracy by section (last 7 days | all time)');
for (const s of ['lang', 'read', 'listen']) lines.push(`- ${s}: ${rate(last7.sec[s])} | ${rate(all.sec[s])}`);
lines.push('', '## Accuracy by type (last 7 days | all time)');
for (const t of Object.keys(all.type)) lines.push(`- ${t}: ${rate(last7.type[t])} | ${rate(all.type[t])}`);
for (const t of Object.keys(all.sub)) lines.push(`- ${t}: ${rate(last7.sub[t])} | ${rate(all.sub[t])}`);
lines.push(`- marked lucky (まぐれ) in last 7 days: ${last7.lucky}`);
lines.push('', '## Weak tags (last 14 days, worst first)');
for (const w of weakTags) lines.push(`- ${w.tag}: ${w.c}/${w.n} correct · ${w.bankQuestions} question(s) exist with this tag`);
lines.push('', '## Reading speed (last 14 days)');
for (const [k, s] of Object.entries(speed)) lines.push(`- ${k}: ${s.passages} passage(s), ${s.charsPerMin} chars/min, time vs target ×${s.vsTarget}`);
lines.push('', '## Unseen questions left in bank');
lines.push(Object.entries(unseen).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none');
lines.push('', '## Recent mistakes (last 3 days)');
for (const m of recentMistakes) {
  lines.push(`- [${m.type}${m.sub ? ':' + m.sub : ''}] ${m.id} tags=${m.tags.join('/')} | ${m.q ? m.q.replace(/\n/g, ' ').slice(0, 90) : m.passage} | chose: ${m.chose} | correct: ${m.correct} | ${m.seconds}s`);
}
console.log(lines.join('\n'));
