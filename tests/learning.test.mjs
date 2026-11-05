import assert from 'node:assert/strict';
import test from 'node:test';
import { DB } from '../js/data.js';
import { recommendReading } from '../js/engine.js';
import { firstAttemptEvidence } from '../js/estimate.js';
import { progress } from '../js/game.js';
import { addDays, getState, load, recordAttempt, save, setDailyGoal, setLucky, todayStr } from '../js/store.js';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const date = todayStr();

test('readiness counts unique first N1 attempts and distinguishes prior, assisted and repeated answers', () => {
  const questions = {
    easier: { type: 'kanji', level: 'N2' },
    reviewed: { type: 'grammar', level: 'N1' },
    assisted: { type: 'listening', sub: 'task', level: 'N1' },
  };
  const log = [
    ...Array.from({ length: 8 }, (_, t) => ({ id: 'easier', ok: 1, d: date, t })),
    { id: 'reviewed', ok: 0, d: addDays(date, -1), t: 0 },
    { id: 'reviewed', ok: 1, d: date, t: 1 },
    { id: 'assisted', ok: 1, assisted: 1, d: date, t: 1 },
    { id: 'assisted', ok: 1, d: date, t: 2 },
  ];
  const sections = firstAttemptEvidence(log, questions, date);
  assert.equal(sections.lang.n, 0);
  assert.equal(sections.lang.accuracy, null);
  assert.equal(sections.listen.n, 0);
  assert.equal(firstAttemptEvidence(log, questions).lang.n, 1);
  assert.equal(firstAttemptEvidence(log, questions).lang.correct, 0);
});

test('reading accuracy requires multiple forms and at least three passages', () => {
  const log = Array.from({ length: 8 }, (_, t) => ({ id: `r${t}`, ok: 1, lk: t === 0, d: date, t }));
  const questions = Object.fromEntries(log.map(({ id, t }) => [id, {
    type: 'reading', level: 'N1', sub: t < 4 ? 'short' : 'mid', passage: `p${t % 2}`,
  }]));
  const sparse = firstAttemptEvidence(log, questions).read;
  assert.deepEqual(sparse, { n: 8, correct: 7, types: 2, passages: 2, accuracy: null });
  questions.r7.passage = 'p2';
  assert.equal(firstAttemptEvidence(log, questions).read.accuracy, 7 / 8);
});

test('a recent reading mistake selects an unseen short passage with that skill', () => {
  store.clear();
  load();
  DB.list = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id, type: 'reading', level: 'N1', sub: 'short', passage: `p${i}`,
    tags: [i < 2 ? '理由' : '主張'], ...(i === 2 ? { date: addDays(date, 1) } : {}),
  }));
  DB.q = Object.fromEntries(DB.list.map(q => [q.id, q]));
  DB.passages = Object.fromEntries(DB.list.map(q => [q.passage, { id: q.passage, target: 150 }]));
  assert.deepEqual(recommendReading(date).ids, ['a']);
  recordAttempt({ id: 'd', ok: 0, ch: 0, ms: 600 });
  recordAttempt({ id: 'b', ok: 0, ch: 0, ms: 600 });
  assert.deepEqual(recommendReading(date).ids, ['a']);
  assert.match(recommendReading(date).reason, /理由/);
  recordAttempt({ id: 'a', ok: 1, ch: 0, ms: 600 });
  assert.equal(recommendReading(date).ids.includes('c'), false);
});

test('goal changes preserve history and lucky edits invalidate round rewards', () => {
  store.clear();
  load();
  const state = getState();
  state.log = Array.from({ length: 40 }, (_, t) => ({ id: 'a', ok: 1, t, d: addDays(date, -1) }));
  save();
  const originalXp = progress().xp;
  setDailyGoal(30);
  assert.equal(progress().xp, originalXp);
  const answers = Array.from({ length: 5 }, (_, n) =>
    recordAttempt({ id: 'a', ok: 1, ch: 0, ms: 600, attemptId: `a${n}`, roundId: 'round' }));
  const beforeLucky = progress().xp;
  setLucky(answers[2].rid, true);
  assert.ok(progress().xp < beforeLucky);
});
