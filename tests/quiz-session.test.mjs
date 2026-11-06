import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getState, load, save } from '../js/store.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.document = { addEventListener() {} };
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
globalThis.location = { hash: '#/' };

test('leaving and reloading preserves the active round and archive question IDs', async () => {
  load();
  const first = await import('../js/quiz.js?initial');
  first.restoreQuiz();
  first.startQuiz({
    ids: ['archive-1', 'archive-1', 'archive-2'],
    title: '短文',
    context: { kind: 'priority', key: '2026-11-05' },
  });
  assert.equal(location.hash, '#/quiz');
  const roundId = getState().activeQuiz.id;
  first.leaveQuiz();
  assert.equal(first.hasSession(), false);

  location.hash = '#/';
  load();
  const reload = await import('../js/quiz.js?reload');
  assert.deepEqual(reload.savedQuizQuestionIds(), ['archive-1', 'archive-2']);
  assert.deepEqual(reload.activeQuiz(), { kind: 'priority', key: '2026-11-05', title: '短文', pos: 0, total: 3 });
  let rebound;
  reload.restoreQuiz(context => {
    rebound = context;
    return {};
  });
  assert.deepEqual(rebound, { kind: 'priority', key: '2026-11-05', title: '短文' });
  assert.equal(reload.resumeQuiz(), true);
  assert.equal(getState().activeQuiz.id, roundId);
  assert.equal(location.hash, '#/quiz');

  reload.leaveQuiz();
  assert.equal(getState().activeQuiz.id, roundId);
  assert.equal(getState().events.length, 0);
  assert.equal(getState().log.length, 0);
});

test('a malformed draft cannot become a resumable quiz', async () => {
  const quiz = await import('../js/quiz.js?malformed');
  getState().activeQuiz = { version: 1, id: 'invalid', items: [{ id: 'archive-1' }], pos: 50 };
  save();
  load();
  assert.equal(quiz.activeQuiz(), null);
  assert.deepEqual(quiz.savedQuizQuestionIds(), []);
  assert.equal(quiz.resumeQuiz(), false);
});
