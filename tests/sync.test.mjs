import assert from 'node:assert/strict';
import { test } from 'node:test';

// One shared fake browser: sync.js caches its config per page load, like the real app.
const files = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: k => files.get(k) ?? null, setItem: (k, v) => files.set(k, v), removeItem: k => files.delete(k) },
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

const puts = [];
const remote = new Map(); // path -> sha
let failNext = 0;
globalThis.fetch = async (url, opts = {}) => {
  const path = decodeURIComponent(new URL(url).pathname.replace('/repos/Prashantsubedi12/n1-daily/contents/', ''));
  if (opts.method !== 'PUT') {
    return remote.has(path) ? Response.json({ sha: remote.get(path) }) : new Response('{}', { status: 404 });
  }
  if (failNext) {
    failNext--;
    return Response.json({ message: 'Bad credentials' }, { status: 401 });
  }
  const body = JSON.parse(opts.body);
  // GitHub refuses to overwrite an existing file without its current sha.
  if (remote.has(path) && body.sha !== remote.get(path)) return new Response('{}', { status: 422 });
  const sha = `sha${puts.length}`;
  remote.set(path, sha);
  puts.push({ path, auth: opts.headers.Authorization, doc: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) });
  return Response.json({ content: { sha } }, { status: 201 });
};

const store = await import('../js/store.js');
const sync = await import('../js/sync.js');
store.load();

test('does nothing without a token, and the token never enters the backup', async () => {
  store.recordAttempt({ id: 'bank-1', ok: false, ch: 1, ms: 900 });
  assert.equal(sync.hasPending(), false);
  assert.equal((await sync.syncNow()).ok, false);
  assert.equal(puts.length, 0);
  sync.setToken('github_pat_test');
  assert.ok(!store.backupJSON().includes('github_pat_test'));
  assert.ok(!files.get('n1daily.v1').includes('github_pat_test'));
});

test('sends one file per day with answers, events, notes and cards', async () => {
  store.logEvent('end', { fin: 1, a: 1, c: 0, of: 1 });
  store.addFeedback('音声が速い');
  const r = await sync.syncNow();
  assert.equal(r.ok, true, r.msg);
  assert.equal(puts.length, 1);
  const { path, auth, doc } = puts[0];
  const day = store.todayStr();
  assert.equal(path, `progress/${day}_${store.getState().deviceId}.json`);
  assert.equal(auth, 'Bearer github_pat_test');
  assert.equal(doc.attempts.length, 1);
  assert.equal(doc.events.length, 1);
  assert.equal(doc.feedback[0].text, '音声が速い');
  assert.equal(doc.app, store.APP_VERSION);
});

test('skips unchanged days and re-sends a day when a record is edited', async () => {
  await sync.syncNow();
  assert.equal(puts.length, 1);
  store.setLucky(store.getState().log[0].rid, true);
  assert.equal(sync.hasPending(), true);
  await sync.syncNow();
  assert.equal(puts.length, 2);
  assert.equal(puts[1].doc.attempts[0].lk, 1);
});

test('recovers when the stored sha is missing (the file already exists on GitHub)', async () => {
  files.set('n1daily.sync', JSON.stringify({ ...JSON.parse(files.get('n1daily.sync')), shas: {}, hashes: {} }));
  // A fresh page load re-reads the config.
  const fresh = await import('../js/sync.js?reload');
  assert.equal((await fresh.syncNow()).ok, true);
  assert.equal(puts.length, 3);
});

test('reports a bad token in Japanese and keeps the day pending', async () => {
  store.recordAttempt({ id: 'bank-2', ok: true, ch: 0, ms: 800 });
  failNext = 1;
  const r = await sync.syncNow();
  assert.equal(r.ok, false);
  assert.match(r.msg, /認証エラー/);
  assert.equal(sync.syncInfo().error, r.msg);
  assert.equal(sync.hasPending(), true);
  assert.equal((await sync.syncNow()).ok, true);
  assert.equal(sync.syncInfo().error, '');
});
