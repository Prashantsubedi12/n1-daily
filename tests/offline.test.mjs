import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {
  DB, contentDateJst, contentStatus, hasMoreArchive, loadArchive, loadData,
} from '../js/data.js';
import { checkDailyFreshness, targetDate } from '../tools/freshness.mjs';
import { APP_VERSION } from '../js/store.js';

const question = id => ({ id, type: 'kanji', q: '練習', choices: ['練習', '本番'], answer: 0 });
const bank = { questions: [question('bank-test')] };
const pack = (date, id) => ({ date, questions: [question(id)] });
const index = (start, bank, daily) => ({ version: 1, start, bank, daily });
const workerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

function worker(scope, answers) {
  const events = new Map();
  const stores = new Map();
  const opened = [];
  let claimed = 0;
  let updated = 0;
  const self = {
    registration: { scope },
    clients: { async claim() { claimed++; } },
    async skipWaiting() { updated++; },
    addEventListener(name, handler) { events.set(name, handler); },
  };
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      opened.push(name);
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(requests) {
          for (const req of requests) entries.set(req.url, new Response('shell ' + req.url));
        },
        async match(url) { return entries.get(url)?.clone(); },
        async put(url, response) { entries.set(url, response.clone()); },
      };
    },
  };
  vm.runInNewContext(workerSource, {
    self, caches, console, URL, Request, Response, AbortController, setTimeout, clearTimeout,
    async fetch(url) {
      const path = url.slice(scope.length);
      const value = answers.get(path);
      if (value === undefined) throw new TypeError('network unavailable');
      if (value instanceof Response) return value.clone();
      return Response.json(value);
    },
  });
  async function dispatch(name, options = {}) {
    const waits = [];
    let response;
    events.get(name)({
      ...options,
      waitUntil(promise) { waits.push(promise); },
      respondWith(promise) { response = promise; },
    });
    await Promise.all(waits);
    return response;
  }
  return {
    caches, dispatch, opened,
    claimed: () => claimed, updated: () => updated,
    fetch: path => dispatch('fetch', { request: new Request(new URL(path, scope)) }),
  };
}

test('verified first install works offline on a subpath and waits for an explicit update', async () => {
  const scope = 'https://example.test/n1-daily/';
  const date = '2000-02-02';
  const answers = new Map([
    ['data/index.json', index('2000-02-01', ['bank/kanji.json'], [date])],
    ['data/bank/kanji.json', bank],
    ['data/daily/' + date + '.json', pack(date, 'daily-test')],
  ]);
  const sw = worker(scope, answers);
  await sw.caches.open('unrelated-cache');
  await sw.caches.open('n1daily:https://example.test/:v1');
  await sw.caches.open('n1daily:' + scope + ':v1');
  await sw.dispatch('install');
  assert.equal(sw.updated(), 0);
  await sw.dispatch('activate');
  assert.equal(sw.claimed(), 1);
  assert.deepEqual(await sw.caches.keys(), [
    'unrelated-cache', 'n1daily:https://example.test/:v1', 'n1daily:' + scope + ':' + APP_VERSION,
  ]);
  const messages = [];
  await sw.dispatch('message', {
    data: { type: 'OFFLINE_STATUS' },
    ports: [{ postMessage: msg => messages.push({ ...msg }) }],
  });
  assert.deepEqual(messages, [{ type: 'OFFLINE_STATUS', ready: true, date }]);

  answers.clear();
  assert.equal(await (await sw.fetch('./')).text(), 'shell ' + scope);
  assert.deepEqual(await (await sw.fetch('data/index.json')).json(),
    index('2000-02-01', ['bank/kanji.json'], [date]));
  assert.deepEqual(await (await sw.fetch('data/bank/kanji.json')).json(), bank);
  assert.equal((await sw.fetch('data/daily/2000-02-03.json')).status, 503);
  await sw.dispatch('message', { data: { type: 'APPLY_UPDATE' } });
  assert.equal(sw.updated(), 1);
});

test('invalid data and 5xx keep the last good pack and incomplete index cannot strand the bank', async () => {
  const date = '2000-03-03';
  const start = '2000-03-02';
  const path = 'data/daily/' + date + '.json';
  const saved = pack(date, 'saved-daily');
  const answers = new Map([
    ['data/index.json', index(start, ['bank/kanji.json'], [date])],
    ['data/bank/kanji.json', bank],
    [path, saved],
  ]);
  const sw = worker('https://example.test/', answers);
  await sw.dispatch('install');
  answers.set(path, new Response('server error', { status: 503 }));
  assert.deepEqual(await (await sw.fetch(path)).json(), saved);
  answers.set(path, pack('2000-02-31', 'invalid-daily'));
  assert.deepEqual(await (await sw.fetch(path)).json(), saved);
  const next = '2000-03-04';
  answers.set('data/index.json', index(start, ['bank/new.json'], [next]));
  assert.deepEqual(await (await sw.fetch('data/index.json')).json(), index(start, ['bank/kanji.json'], [date]));
  answers.set('data/bank/new.json', bank);
  assert.deepEqual(await (await sw.fetch('data/index.json')).json(), index(start, ['bank/new.json'], [next]));
  answers.set('data/index.json', { ...index(start, ['bank/new.json'], [next]), version: 2 });
  assert.deepEqual(await (await sw.fetch('data/index.json')).json(), index(start, ['bank/new.json'], [date, next]));
  answers.delete('data/index.json');
  assert.deepEqual(await (await sw.fetch('data/index.json')).json(), index(start, ['bank/new.json'], [date, next]));
});

test('loader keeps referenced old packs and reports an unavailable current pack', async t => {
  const days = Array.from({ length: 19 }, (_, i) => '2000-01-' + String(i + 1).padStart(2, '0'));
  const today = days[17];
  const requests = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    if (url === 'data/index.json') return Response.json(index(days[0], ['bank/kanji.json'], days));
    if (url === 'data/bank/kanji.json') return Response.json(bank);
    if (url === 'data/changelog.json') return Response.json({ entries: [] });
    const date = url.slice(11, -5);
    if (date === today) return new Response(null, { status: 503 });
    return Response.json(pack(date, 'd' + date.slice(5).replace('-', '') + '-01'));
  });

  await loadData({ today, questionIds: ['d0101-01'], learnedDates: [days[1]] });
  assert.ok(DB.q['d0101-01']);
  assert.ok(DB.q['d0102-01']);
  assert.ok(!DB.q['d0103-01']);
  assert.ok(!requests.includes('data/daily/' + days[18] + '.json'));
  assert.equal(DB.latestIndexedDate, today);
  assert.deepEqual(contentStatus(today), {
    state: 'stale', reason: 'pack-unavailable', date: days[16], unavailable: ['daily/' + today + '.json'],
  });
  assert.equal(hasMoreArchive(), true);
  await loadArchive();
  assert.ok(DB.q['d0103-01']);
  assert.equal(DB.list.filter(q => q.id === 'd0101-01').length, 1);
});

test('freshness uses JST midnight and requires the target pack as well as its index entry', () => {
  const before = new Date('2026-11-04T14:59:59Z');
  const after = new Date('2026-11-04T15:00:00Z');
  assert.equal(contentDateJst(before), '2026-11-04');
  assert.equal(contentDateJst(after), '2026-11-05');
  assert.equal(targetDate(['--next'], before), '2026-11-05');
  assert.equal(targetDate(['--date', '2026-11-05'], after), '2026-11-05');
  assert.throws(() => targetDate(['--date', '2026-11-31'], after));
  const date = '2026-11-05';
  const readIndex = () => ({ daily: ['2026-11-03'] });
  assert.deepEqual(checkDailyFreshness(date, readIndex), {
    ok: false, reason: 'date not indexed', latest: '2026-11-03',
  });
  const readBroken = path => path === 'index.json' ? { daily: [date] } : pack('2026-11-03', 'test');
  assert.deepEqual(checkDailyFreshness(date, readBroken), {
    ok: false, reason: 'indexed pack unavailable or invalid', latest: date,
  });
  const readGood = path => path === 'index.json' ? { daily: [date] } : pack(date, 'test');
  assert.deepEqual(checkDailyFreshness(date, readGood), { ok: true, latest: date });
});
