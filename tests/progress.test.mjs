import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  addFeedback, backupJSON, getPersistenceError, getState, getStateRevision, goalFor,
  importBackup, load, logEvent, recordAttempt, resetProgress, restoreRecoveryBackup,
  save, setDailyGoal, setLearned, setLucky, setPassageTime, srs,
} from '../js/store.js';
import { MAX_BACKUP_BYTES } from '../js/backup.js';

const STORAGE = 'n1daily.v1';
const past = '2026-10-01';
const time = Date.parse(past + 'T12:00:00Z');
let files;
let deny;

beforeEach(() => {
  files = new Map();
  deny = '';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => files.get(key) ?? null,
      removeItem: key => files.delete(key),
      setItem(key, value) {
        if (key === deny) throw new Error('Storage quota');
        files.set(key, value);
      },
    },
  });
  load();
});

function answer() {
  return recordAttempt({ id: 'bank-1', ok: true, ch: 2, ms: 1200, attemptId: 'test-attempt' });
}

function legacy() {
  return {
    created: past, deviceId: 'old-device',
    settings: { daily: 80, ghToken: 'old-test-token' },
    sync: { counts: { [past]: 1 } },
    log: [{ id: 'old-question', ok: 0, ch: 1, ms: 500, d: past, t: time }],
    events: [{ k: 'match', fin: 1, d: past, t: time + 1 }],
    feedback: [{ text: 'メモ', d: past, t: time + 2 }],
    learned: { 'old-card': past },
  };
}

test('migration strips old credentials and keeps a fixed historical goal', () => {
  files.set(STORAGE, JSON.stringify(legacy()));
  load();
  assert.equal(goalFor(past), 80);
  const revision = getStateRevision();
  setDailyGoal(30);
  assert.equal(goalFor(past), 80);
  assert.ok(getStateRevision() > revision);
  assert.equal(getState().log[0].id, 'old-question');
  assert.equal(getState().learned['old-card'], past);
  assert.doesNotMatch(files.get(STORAGE), /old-test-token|ghToken|"sync"/);
  assert.doesNotMatch(backupJSON(), /old-test-token|ghToken|"sync"/);
});

test('fresh device merges all record types exactly once and applies revisions and removals', () => {
  const entry = answer();
  assert.equal(answer().rid, entry.rid);
  logEvent('end', { fin: 1, priorityDate: past }, { eventId: 'end:test' });
  logEvent('end', { fin: 1, priorityDate: past }, { eventId: 'end:test' });
  addFeedback('メモ', entry.id);
  setLearned('new-card', true);
  getState().activeQuiz = { version: 1, id: 'not-in-backup' };
  const initial = backupJSON();
  assert.doesNotMatch(initial, /activeQuiz|not-in-backup/);
  setLucky(entry.rid, true);
  setPassageTime(entry.rid, 4321);
  setLearned('new-card', false);
  const revised = backupJSON();
  files.clear();
  load();
  const ownDevice = getState().deviceId;

  importBackup(initial);
  importBackup(revised);
  importBackup(initial);
  importBackup(revised);
  load();
  assert.equal(getState().deviceId, ownDevice);
  assert.equal(getState().log.length, 1);
  assert.equal(getState().events.length, 1);
  assert.equal(getState().events[0].priorityDate, past);
  assert.equal(getState().feedback.length, 1);
  assert.equal(getState().log[0].lk, 1);
  assert.equal(getState().log[0].pt, 4321);
  assert.equal(getState().learned['new-card'], undefined);
  assert.equal(getState().learnedVersions['new-card'].date, null);
});

test('legacy backup and progress-day imports deduplicate the same history', () => {
  const v1 = legacy();
  importBackup(JSON.stringify(v1));
  const day = JSON.stringify({
    date: past, attempts: v1.log, events: v1.events, feedback: v1.feedback, learned: ['old-card'],
  });
  assert.throws(() => importBackup(day, 'replace'), /記録に追加/);
  importBackup(day);
  assert.equal(getState().log.length, 1);
  assert.equal(getState().events.length, 1);
  assert.equal(getState().feedback.length, 1);
  assert.equal(getState().learned['old-card'], past);
});

test('malformed, oversized, and failed imports keep current progress', () => {
  answer();
  const before = files.get(STORAGE);
  const recovery = 'n1daily.recovery';
  files.set(recovery, 'earlier backup');
  const invalid = { ...legacy(), learned: { card: '2026-02-31' } };
  assert.throws(() => importBackup(JSON.stringify(invalid)));
  assert.throws(() => importBackup('x'.repeat(MAX_BACKUP_BYTES + 1)), /8 MB/);
  assert.equal(files.get(STORAGE), before);
  deny = STORAGE;
  assert.throws(() => importBackup(JSON.stringify(legacy()), 'replace'), /保持/);
  assert.equal(files.get(STORAGE), before);
  assert.equal(files.get(recovery), 'earlier backup');
  assert.equal(getState().log[0].id, 'bank-1');
});

test('replace preserves the device identity and previous progress can be recovered', () => {
  answer();
  const device = getState().deviceId;
  importBackup(JSON.stringify(legacy()), 'replace');
  assert.equal(getState().deviceId, device);
  assert.equal(getState().settings.daily, 80);
  assert.equal(getState().log[0].id, 'old-question');
  restoreRecoveryBackup();
  assert.equal(getState().log[0].id, 'bank-1');
  resetProgress();
  assert.deepEqual(getState().log, []);
  restoreRecoveryBackup();
  assert.equal(getState().log[0].id, 'bank-1');
});

test('failed writes are observable and unreadable state is protected', () => {
  deny = STORAGE;
  assert.equal(save(), false);
  assert.match(getPersistenceError(), /保存できません/);
  deny = '';
  assert.equal(save(), true);
  assert.equal(getPersistenceError(), '');

  files.set(STORAGE, '{ invalid');
  load();
  answer();
  assert.match(getPersistenceError(), /上書きせず/);
  assert.equal(files.get(STORAGE), '{ invalid');
});

test('assisted listening stays in backups without establishing mastery', () => {
  recordAttempt({
    id: 'listen-1', ok: true, ch: 0, ms: 1100, assisted: true, attemptId: 'answer-1', roundId: 'round-1',
  });
  assert.equal(srs()['listen-1'], undefined);
  const copy = backupJSON();
  files.clear();
  load();
  importBackup(copy);
  const [entry] = getState().log;
  assert.equal(entry.assisted, 1);
  assert.equal(entry.roundId, 'round-1');
  assert.equal(srs()['listen-1'], undefined);
});

test('stale tabs preserve the latest durable state and can export their own work', () => {
  answer();
  const newer = JSON.parse(files.get(STORAGE));
  newer.events.push({ rid: 'new-tab-event', k: 'open', t: time, d: past });
  files.set(STORAGE, JSON.stringify(newer));
  setLucky('test-attempt', true);
  assert.match(getPersistenceError(), /別のタブ/);
  assert.equal(JSON.parse(files.get(STORAGE)).log[0].lk, undefined);
  const local = backupJSON();
  load();
  importBackup(local);
  assert.equal(getState().log[0].lk, 1);
  assert.equal(getState().events.length, 1);
});
