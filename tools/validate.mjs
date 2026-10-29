#!/usr/bin/env node
// Validates every data file listed in data/index.json. Exit code 1 on any error.
// Usage: node tools/validate.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const TYPES = ['kanji', 'context', 'paraphrase', 'usage', 'grammar', 'order', 'textgrammar', 'reading', 'listening'];
const SUBS = {
  reading: ['short', 'mid', 'long', 'integrated', 'opinion', 'info'],
  listening: ['task', 'point', 'summary', 'response'],
};
const PASSAGE_KINDS = ['short', 'mid', 'long', 'integrated', 'opinion', 'info', 'textgrammar'];

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const str = v => typeof v === 'string' && v.trim().length > 0;

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(path.replace(ROOT + '/', ''), `invalid JSON — ${e.message}`);
    return null;
  }
}

const index = readJSON(join(DATA, 'index.json'));
if (!index) {
  console.error(errors.join('\n'));
  process.exit(1);
}
if (!str(index.exam) || !str(index.start)) err('index.json', 'needs "exam" and "start" dates');

const files = [...(index.bank || []), ...(index.daily || []).map(d => `daily/${d}.json`)];

// Every file on disk must be listed, or the app will never load it.
for (const dir of ['bank', 'daily']) {
  const p = join(DATA, dir);
  if (!existsSync(p)) continue;
  for (const f of readdirSync(p).filter(f => f.endsWith('.json'))) {
    if (!files.includes(`${dir}/${f}`)) err(`data/${dir}/${f}`, 'exists but is not listed in index.json');
  }
}
const dailies = index.daily || [];
if (new Set(dailies).size !== dailies.length) err('index.json', 'duplicate daily dates');
if ([...dailies].sort().join() !== dailies.join()) warn('index.json', 'daily dates are not in order');

const qIds = new Set();
const pIds = new Set();
const cardIds = new Set();
const passageUse = {};
const counts = {};
const allQuestions = [];
const allPassages = {};

for (const f of files) {
  const path = join(DATA, f);
  if (!existsSync(path)) {
    err(`data/${f}`, 'listed in index.json but missing');
    continue;
  }
  const doc = readJSON(path);
  if (!doc) continue;
  const where = `data/${f}`;

  if (f.startsWith('daily/')) {
    const date = f.slice(6, 16);
    if (doc.date !== date) err(where, `date "${doc.date}" does not match file name`);
    if (!str(doc.report)) warn(where, 'no report text');
  }

  for (const p of doc.passages || []) {
    const w = `${where} passage ${p.id}`;
    if (!str(p.id)) err(w, 'missing id');
    else if (pIds.has(p.id)) err(w, 'duplicate passage id');
    pIds.add(p.id);
    allPassages[p.id] = p;
    if (!PASSAGE_KINDS.includes(p.kind)) err(w, `bad kind "${p.kind}"`);
    if (!str(p.text)) err(w, 'empty text');
    if (typeof p.target !== 'number' || p.target <= 0) err(w, 'target (seconds) must be a positive number');
  }

  for (const q of doc.questions || []) {
    const w = `${where} ${q.id || '(no id)'}`;
    if (!str(q.id)) err(w, 'missing id');
    else if (qIds.has(q.id)) err(w, 'duplicate question id');
    qIds.add(q.id);
    allQuestions.push(q);
    if (!TYPES.includes(q.type)) {
      err(w, `bad type "${q.type}"`);
      continue;
    }
    counts[q.type] = (counts[q.type] || 0) + 1;
    if (SUBS[q.type] && !SUBS[q.type].includes(q.sub)) err(w, `bad sub "${q.sub}" for ${q.type}`);
    if (!['N1', 'N2'].includes(q.level)) err(w, 'level must be N1 or N2');
    if (!Array.isArray(q.tags)) err(w, 'tags must be an array');
    if (!Array.isArray(q.choices)) {
      err(w, 'choices must be an array');
      continue;
    }
    const nChoices = q.type === 'listening' && q.sub === 'response' ? 3 : 4;
    if (q.choices.length !== nChoices) err(w, `needs ${nChoices} choices, has ${q.choices.length}`);
    if (q.choices.some(c => !str(c))) err(w, 'empty choice');
    if (new Set(q.choices).size !== q.choices.length) err(w, 'duplicate choices');
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) err(w, `answer index ${q.answer} out of range`);
    if (!str(q.exp)) err(w, 'missing explanation (exp)');

    if (q.type === 'listening') {
      if (!Array.isArray(q.script) || !q.script.length) err(w, 'listening needs script');
      else if (q.script.some(l => !['M', 'F', 'N'].includes(l.s) || !str(l.t))) err(w, 'script lines need s (M/F/N) and t');
      if (q.sub !== 'response' && !str(q.ask)) err(w, 'listening needs ask (the spoken question)');
    } else if (!str(q.q)) {
      err(w, 'missing question text (q)');
    }

    if (q.type === 'reading' || q.type === 'textgrammar') {
      if (!str(q.passage)) err(w, `${q.type} needs a passage id`);
      else passageUse[q.passage] = (passageUse[q.passage] || 0) + 1;
    }
    if (q.type === 'order') {
      const stars = (q.q.match(/＿★＿/g) || []).length;
      const blanks = (q.q.match(/＿＿/g) || []).length;
      if (stars !== 1 || blanks !== 3) err(w, `order question needs 3 × ＿＿ and 1 × ＿★＿ (found ${blanks} / ${stars})`);
    }
    if (q.type === 'kanji' && !/__.+__/.test(q.q)) err(w, 'kanji question must underline the word with __…__');
    if (q.type === 'paraphrase' && !/__.+__/.test(q.q)) err(w, 'paraphrase question must underline the phrase with __…__');
    if (q.type === 'usage' && !/^\S+$/.test(q.q.trim())) warn(w, 'usage q should be just the target word');
  }

  for (const c of doc.learn?.grammar || []) {
    const w = `${where} card ${c.id}`;
    if (!str(c.id) || cardIds.has(c.id)) err(w, 'missing or duplicate card id');
    cardIds.add(c.id);
    if (!str(c.point) || !str(c.ja) || !Array.isArray(c.ex) || !c.ex.length) err(w, 'grammar card needs point, ja, ex[]');
  }
  for (const c of doc.learn?.vocab || []) {
    const w = `${where} card ${c.id}`;
    if (!str(c.id) || cardIds.has(c.id)) err(w, 'missing or duplicate card id');
    cardIds.add(c.id);
    if (!str(c.w) || !str(c.r) || !str(c.ja)) err(w, 'vocab card needs w, r, ja');
  }
}

for (const q of allQuestions) {
  if (q.passage && !allPassages[q.passage]) err(q.id, `passage "${q.passage}" not found`);
}
for (const id of Object.keys(allPassages)) {
  if (!passageUse[id]) warn(`passage ${id}`, 'has no questions');
}

// Near-duplicate prompts usually mean the generator repeated itself.
const seenQ = new Map();
for (const q of allQuestions) {
  if (!q.q || q.passage) continue;
  const key = q.q.replace(/\s|__|＿|★/g, '');
  if (seenQ.has(key)) warn(q.id, `same question text as ${seenQ.get(key)}`);
  else seenQ.set(key, q.id);
}

console.log(`files: ${files.length}  questions: ${allQuestions.length}  passages: ${Object.keys(allPassages).length}  cards: ${cardIds.size}`);
console.log('by type: ' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '));
if (warnings.length) console.log(`\n${warnings.length} warning(s):\n  ` + warnings.join('\n  '));
if (errors.length) {
  console.error(`\n${errors.length} ERROR(S):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log('\nOK');
