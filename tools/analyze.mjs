#!/usr/bin/env node
// Reads the learner's synced attempts (progress branch) and prints a weakness report
// that the daily generator uses to decide what to write next.
//
// Usage:
//   git fetch origin progress
//   node tools/analyze.mjs                 # reads progress files from origin/progress
//   node tools/analyze.mjs --dir path/     # or from a local folder of progress JSON files
//   node tools/analyze.mjs --json          # machine-readable output
//   node tools/analyze.mjs --gate FILE     # improver: has the learner finished a round since FILE's mark?
//   node tools/analyze.mjs --mark FILE     # improver: record that everything up to now has been handled

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { estimateScores } from '../js/estimate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const ref = opt('--ref') || 'origin/progress';
const dir = opt('--dir');
const asJSON = args.includes('--json');
const gateFile = opt('--gate');
const markFile = opt('--mark');

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

const docs = progressDocs();
const byT = (a, b) => a.t - b.t;
const allAttempts = docs.flatMap(d => d.attempts || []).sort(byT);
const attempts = allAttempts.filter(a => !a.rt);
// Added in app v8: round/open events, feedback notes and 覚えた cards.
const events = docs.flatMap(d => d.events || []).sort(byT);
const feedback = docs.flatMap(d => d.feedback || []).sort(byT);
const learned = docs.flatMap(d => (d.learned || []).map(id => ({ id, d: d.date })));
const appVersions = [...new Set(docs.map(d => d.app).filter(Boolean))];

// ---- improver gate: act only after the learner actually studied ----
if (gateFile || markFile) {
  const file = gateFile || markFile;
  const last = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).lastSeenT || 0 : 0;
  const latestT = Math.max(0, ...[...allAttempts, ...events, ...feedback].map(x => x.t || 0));
  if (markFile) {
    writeFileSync(file, JSON.stringify({ lastSeenT: latestT, markedAt: new Date().toISOString() }, null, 2) + '\n');
    console.log(`marked ${new Date(latestT).toISOString()}`);
    process.exit(0);
  }
  const finishedRounds = events.filter(e => e.k === 'end' && e.fin === 1 && e.t > last);
  const newAttempts = attempts.filter(a => a.t > last).length;
  const newNotes = feedback.filter(f => f.t > last);
  // Phones still on an app without events (before v8) can only be judged by answer count.
  const active = finishedRounds.length > 0 || (!events.length && newAttempts >= 10);
  console.log(JSON.stringify({ active, since: last ? new Date(last).toISOString() : null, finishedRounds: finishedRounds.length, newAttempts, newFeedback: newNotes }, null, 2));
  process.exit(0);
}

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

// ---- estimated JLPT score (same formula as the app's home screen) ----
const estimate14 = estimateScores(attempts, Q, daysAgo(13));
const estimateAll = estimateScores(attempts, Q);

// ---- behaviour: how the app is actually used (for the improver agent) ----
const recentEvents = events.filter(e => e.d >= daysAgo(6));
const rounds = {};
for (const e of recentEvents) {
  if (e.k !== 'start' && e.k !== 'end') continue;
  const r = (rounds[e.m] ||= { started: 0, finished: 0, quit: 0, answeredWhenQuit: 0 });
  if (e.k === 'start') r.started++;
  else if (e.fin) r.finished++;
  else {
    r.quit++;
    r.answeredWhenQuit += e.a || 0;
  }
}
const minutesPerDay = {};
const hours = {};
for (const a of allAttempts) {
  if (a.d < daysAgo(6)) continue;
  minutesPerDay[a.d] = (minutesPerDay[a.d] || 0) + Math.min(a.ms || 0, 180000) / 60000;
  const h = new Date(a.t).getHours();
  hours[h] = (hours[h] || 0) + 1;
}
for (const d of Object.keys(minutesPerDay)) minutesPerDay[d] = Math.round(minutesPerDay[d]);
const studyDays = new Set(attempts.map(a => a.d));
const openedNotStudied = [...new Set(events.filter(e => e.k === 'open').map(e => e.d))].filter(d => !studyDays.has(d)).sort();

const listenRecent = attempts.filter(a => a.d >= daysAgo(13) && Q[a.id]?.type === 'listening' && a.pl != null);
const byPlays = { once: { n: 0, c: 0 }, more: { n: 0, c: 0 } };
for (const a of listenRecent) {
  const b = a.pl > 1 ? byPlays.more : byPlays.once;
  b.n++;
  if (a.ok && !a.lk) b.c++;
}

// Correct but slow (> 2× the median time for that type): known, but not automatic yet.
const recent14 = attempts.filter(a => a.d >= daysAgo(13) && Q[a.id] && !Q[a.id].passage);
const medianMs = {};
for (const t of new Set(recent14.map(a => Q[a.id].type))) {
  const ms = recent14.filter(a => Q[a.id].type === t).map(a => a.ms).sort((x, y) => x - y);
  medianMs[t] = ms[Math.floor(ms.length / 2)];
}
const slowCorrect = recent14
  .filter(a => a.ok && !a.lk && a.ms > 2 * medianMs[Q[a.id].type] && a.ms > 20000)
  .slice(-15)
  .map(a => ({ id: a.id, type: Q[a.id].type, tags: Q[a.id].tags, seconds: Math.round(a.ms / 1000) }));

// Got it right before, wrong the last time: forgetting.
const history = {};
for (const a of attempts) (history[a.id] ||= []).push(a.ok && !a.lk);
const forgotten = Object.entries(history)
  .filter(([, h]) => h.length >= 2 && !h[h.length - 1] && h.slice(0, -1).some(Boolean))
  .map(([id]) => ({ id, type: Q[id]?.type, tags: Q[id]?.tags }))
  .slice(0, 20);

// The same wrong option picked again and again under one tag: a trap the learner falls for.
const traps = {};
for (const a of attempts) {
  if (a.ok || a.d < daysAgo(13) || !Q[a.id]) continue;
  const chose = Q[a.id].choices[a.ch];
  for (const t of Q[a.id].tags || []) {
    const k = `${t} → ${chose}`;
    traps[k] = (traps[k] || 0) + 1;
  }
}
const trapChoices = Object.entries(traps).filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).slice(0, 15).map(([k, n]) => ({ pattern: k, times: n }));

const flagged = feedback
  .filter(f => f.id)
  .map(f => ({ id: f.id, reason: f.text, date: f.d, q: Q[f.id]?.q || Q[f.id]?.ask || null, answer: Q[f.id] ? Q[f.id].choices[Q[f.id].answer] : null, file: Q[f.id]?.date ? `daily/${Q[f.id].date}.json` : 'bank' }));
const notes = feedback.filter(f => !f.id).map(f => ({ date: f.d, text: f.text }));

const behavior = {
  appVersions,
  roundsLast7: rounds,
  minutesPerDayLast7: minutesPerDay,
  answersByHourLast7: hours,
  openedButNotStudied: openedNotStudied,
  listeningAccuracyByPlays: byPlays,
  cardsLearnedLast7: learned.filter(l => l.d >= daysAgo(6)).length,
  slowCorrect,
  forgotten,
  trapChoices,
};

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
  estimate: { last14: estimate14, allTime: estimateAll },
  behavior,
  flaggedQuestions: flagged,
  feedbackNotes: notes,
};

if (asJSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const lines = [];
lines.push(`# Learner report — ${dstr(today)}`);
lines.push(`Attempts: ${all.n} total · ${report.daysStudied} day(s) studied · last study day: ${report.lastStudyDay || 'none yet'}`);
if (latestDailyUsage) lines.push(`Latest daily file ${latestDailyUsage.date}: ${latestDailyUsage.attempted}/${latestDailyUsage.questions} questions attempted`);
const est = e => ['lang', 'read', 'listen'].map(k => `${k} ${e.sections[k].score ?? '—'}/60 (n=${e.sections[k].n})`).join(' · ') + ` · total ${e.total ?? '—'}/180${e.total != null ? (e.pass ? ' PASS' : ' below pass') : ''}`;
lines.push('', '## Estimated JLPT score (pass = 100 total, every section ≥19)');
lines.push(`- last 14 days: ${est(estimate14)}`);
lines.push(`- all time: ${est(estimateAll)}`);
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
lines.push('', '## Reported questions (fix these)');
for (const f of flagged) lines.push(`- ${f.id} (${f.file}) "${f.reason}" on ${f.date} | ${f.q ? f.q.replace(/\n/g, ' ').slice(0, 80) : ''} | answer: ${f.answer}`);
if (!flagged.length) lines.push('none');
lines.push('', '## Feedback notes from the learner');
for (const n of notes) lines.push(`- ${n.date}: ${n.text}`);
if (!notes.length) lines.push('none');
lines.push('', '## How the app is used (last 7 days)');
lines.push(`- app versions seen: ${appVersions.join(', ') || 'unknown (before v8)'}`);
for (const [m, r] of Object.entries(rounds)) lines.push(`- ${m}: started ${r.started}, finished ${r.finished}, quit ${r.quit}${r.quit ? ` (avg ${Math.round(r.answeredWhenQuit / r.quit)} answered before quitting)` : ''}`);
lines.push(`- minutes per day: ${Object.entries(minutesPerDay).map(([d, m]) => `${d.slice(5)} ${m}`).join(' · ') || '—'}`);
lines.push(`- answers by hour: ${Object.entries(hours).map(([h, n]) => `${h}時 ${n}`).join(' · ') || '—'}`);
lines.push(`- opened the app but answered nothing: ${openedNotStudied.join(', ') || 'never'}`);
lines.push(`- listening accuracy by plays: once ${rate(byPlays.once)} · replayed ${rate(byPlays.more)}`);
lines.push(`- 覚えた cards checked: ${behavior.cardsLearnedLast7}`);
lines.push('', '## Correct but slow (not automatic yet)');
for (const x of slowCorrect) lines.push(`- ${x.id} [${x.type}] ${x.tags?.join('/')} ${x.seconds}s`);
if (!slowCorrect.length) lines.push('none');
lines.push('', '## Forgotten (right before, wrong last time)');
for (const x of forgotten) lines.push(`- ${x.id} [${x.type}] ${x.tags?.join('/')}`);
if (!forgotten.length) lines.push('none');
lines.push('', '## Traps (same wrong option chosen ≥2 times, 14 days)');
for (const x of trapChoices) lines.push(`- ${x.pattern} ×${x.times}`);
if (!trapChoices.length) lines.push('none');
console.log(lines.join('\n'));
