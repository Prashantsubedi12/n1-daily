// Keep the app shell on one release until its replacement is ready to activate.
const SCOPE = self.registration.scope;
const PREFIX = 'n1daily:' + SCOPE + ':';
const VERSION = PREFIX + 'v13';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'css/study.css',
  'js/app.js',
  'js/store.js',
  'js/backup.js',
  'js/data.js',
  'js/engine.js',
  'js/quiz.js',
  'js/pages.js',
  'js/util.js',
  'js/speech.js',
  'js/estimate.js',
  'js/coach.js',
  'js/game.js',
  'js/match.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const absolute = path => new URL(path, SCOPE).href;
const INDEX = absolute('data/index.json');
const STARTER = absolute('.n1daily/starter');
const BANK = /^bank\/[a-z0-9-]+\.json$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const json = data => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json' },
});

function validDay(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function tokyoDay() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts();
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return [values.year, values.month, values.day].join('-');
}

function validData(path, data) {
  if (!data || typeof data !== 'object') return false;
  if (path === 'index.json') {
    return data.version === 1 && validDay(data.start) && Array.isArray(data.bank) && data.bank.length > 0 &&
      data.bank.every(f => typeof f === 'string' && BANK.test(f)) &&
      Array.isArray(data.daily) && data.daily.every(validDay);
  }
  if (path === 'changelog.json') return Array.isArray(data.entries);
  if (path.startsWith('daily/') && data.date !== path.slice(6, -5)) return false;
  const passages = data.passages || [];
  const cards = data.learn || {};
  return Array.isArray(data.questions) && data.questions.length > 0 &&
    data.questions.every(q => q && typeof q.id === 'string' && typeof q.type === 'string' &&
      Array.isArray(q.choices) && q.choices.length >= 2 &&
      q.choices.every(c => typeof c === 'string') && Number.isInteger(q.answer) &&
      q.answer >= 0 && q.answer < q.choices.length &&
      (q.type === 'listening'
        ? Array.isArray(q.script) && q.script.length > 0 && q.script.every(l => l && typeof l.t === 'string')
        : typeof q.q === 'string')) &&
    Array.isArray(passages) && passages.every(p => p && typeof p.id === 'string' && typeof p.text === 'string') &&
    ['vocab', 'grammar'].every(kind => cards[kind] === undefined ||
      (Array.isArray(cards[kind]) && cards[kind].every(c => c && typeof c.id === 'string')));
}

async function fetchData(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(absolute('data/' + path), { cache: 'no-cache', signal: controller.signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.clone().json();
    if (!validData(path, data)) throw new Error('Invalid content: ' + path);
    return { res, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function installStarter() {
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL.map(path => new Request(absolute(path), { cache: 'reload' })));
  const { res, data: index } = await fetchData('index.json');
  await Promise.all(index.bank.map(async path => {
    const entry = await fetchData(path);
    await cache.put(absolute('data/' + path), entry.res);
  }));

  // A failed daily pack shouldn't keep a usable bank from working offline.
  const candidates = index.daily.filter(d => d <= tokyoDay()).sort().reverse().slice(0, 3);
  let date = null;
  for (const day of candidates) {
    const path = 'daily/' + day + '.json';
    const entry = await fetchData(path).catch(() => null);
    if (!entry) continue;
    await cache.put(absolute('data/' + path), entry.res);
    date = day;
    break;
  }
  await cache.put(INDEX, res);
  await cache.put(STARTER, json({ index, date }));
}

self.addEventListener('install', event => {
  event.waitUntil(installStarter());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== VERSION)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function offlineStatus() {
  const cache = await caches.open(VERSION);
  const marker = await cache.match(STARTER);
  if (!marker) return { ready: false, date: null };
  const { index, date } = await marker.json();
  const files = [...SHELL, 'data/index.json', ...index.bank.map(path => 'data/' + path)];
  if (date) files.push('data/daily/' + date + '.json');
  const entries = await Promise.all(files.map(path => cache.match(absolute(path))));
  return { ready: entries.every(Boolean), date };
}

self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_UPDATE') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'OFFLINE_STATUS' && event.ports[0]) {
    event.waitUntil(offlineStatus().then(status => {
      event.ports[0].postMessage({ type: 'OFFLINE_STATUS', ...status });
    }));
  }
});

async function fallbackIndex(cache) {
  const saved = await cache.match(INDEX);
  const starter = await cache.match(STARTER);
  if (!starter) return saved;
  const { index } = await starter.json();
  if (!saved) return json(index);
  const latest = await saved.json();
  const banks = await Promise.all(latest.bank.map(f => cache.match(absolute('data/' + f))));
  const daily = [...new Set([...index.daily, ...latest.daily])].sort();
  return json({ ...latest, bank: banks.every(Boolean) ? latest.bank : index.bank, daily });
}

async function prepareBanks(cache, paths) {
  await Promise.all(paths.map(async path => {
    const url = absolute('data/' + path);
    if (await cache.match(url)) return;
    const { res } = await fetchData(path);
    await cache.put(url, res);
  }));
}

async function serveData(path, request) {
  const cache = await caches.open(VERSION);
  let entry;
  try {
    entry = await fetchData(path);
    if (path === 'index.json') await prepareBanks(cache, entry.data.bank);
  } catch {
    const fallback = path === 'index.json'
      ? await fallbackIndex(cache)
      : await cache.match(absolute('data/' + path));
    return fallback || new Response(null, { status: 503, statusText: 'Study content unavailable' });
  }
  try {
    await cache.put(absolute('data/' + path), entry.res.clone());
  } catch (err) {
    console.warn('Could not save offline content', request.url, err);
  }
  return entry.res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  const path = req.url.slice(SCOPE.length).split(/[?#]/, 1)[0];
  const dataPath = path.startsWith('data/') ? path.slice(5) : '';

  if (dataPath === 'index.json' || dataPath === 'changelog.json' ||
      BANK.test(dataPath) || /^daily\/\d{4}-\d{2}-\d{2}\.json$/.test(dataPath)) {
    const result = serveData(dataPath, req);
    event.respondWith(result);
    event.waitUntil(result.then(() => undefined));
    return;
  }

  const key = path || './';
  if (!SHELL.includes(key)) return;
  event.respondWith(caches.open(VERSION).then(cache => cache.match(absolute(key)))
    .then(cached => cached || fetch(req)));
});
