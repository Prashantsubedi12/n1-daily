// Load the bank and recent packs first. Keep historical material available on demand.

export const DB = {
  index: null,
  q: {},
  list: [],
  passages: {},
  groups: {},
  learn: [],
  daily: {},
  changelog: [],
  unavailable: [],
  latestIndexedDate: null,
};

const RECENT_PACKS = 14;
const BANK_PATH = /^bank\/[a-z0-9-]+\.json$/;
const JST = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
});

let documents = new Map();
let loadedThrough = null;
let archiveLoad = null;

export function contentDateJst(date = new Date()) {
  const parts = Object.fromEntries(JST.formatToParts(date).map(({ type, value }) => [type, value]));
  return [parts.year, parts.month, parts.day].join('-');
}

export function isContentDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

export function isBankPath(value) {
  return typeof value === 'string' && BANK_PATH.test(value);
}

async function getJSON(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === 'index.json' ? 12000 : 7500);
  try {
    const res = await fetch('data/' + path, { cache: 'no-cache', signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} data/${path}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function validIndex(index) {
  return index?.version === 1 && isContentDate(index.start) &&
    Array.isArray(index.bank) && index.bank.length > 0 && index.bank.every(isBankPath) &&
    Array.isArray(index.daily) && index.daily.every(isContentDate);
}

function validPack(path, doc) {
  if (!doc || (path.startsWith('daily/') && doc.date !== path.slice(6, -5))) return false;
  return Array.isArray(doc.questions) && doc.questions.length > 0 &&
    doc.questions.every(q => q && typeof q.id === 'string' && typeof q.type === 'string' &&
      Array.isArray(q.choices) && q.choices.length >= 2 && q.choices.every(c => typeof c === 'string') &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length &&
      (q.type === 'listening'
        ? Array.isArray(q.script) && q.script.length > 0 && q.script.every(l => l && typeof l.t === 'string')
        : typeof q.q === 'string')) &&
    Array.isArray(doc.passages || []) &&
    (doc.passages || []).every(p => p && typeof p.id === 'string' && typeof p.text === 'string') &&
    ['grammar', 'vocab'].every(kind => doc.learn?.[kind] === undefined ||
      (Array.isArray(doc.learn[kind]) && doc.learn[kind].every(c => c && typeof c.id === 'string')));
}

function dailyPath(date) {
  return `daily/${date}.json`;
}

async function fetchDocuments(files) {
  return Promise.all(files.map(async path => {
    try {
      const doc = await getJSON(path);
      if (!validPack(path, doc)) throw new Error('Invalid question data');
      return [path, doc];
    } catch (err) {
      console.warn('could not load', path, err);
      return [path, null];
    }
  }));
}

function assemble(docs, index) {
  const passages = Object.create(null);
  const q = Object.create(null);
  const groups = Object.create(null);
  const daily = Object.create(null);
  const list = [];
  const learn = [];
  const unavailable = [];
  const ordered = [...index.bank, ...index.daily.map(dailyPath)];
  for (const path of ordered) {
    if (!docs.has(path)) continue;
    const doc = docs.get(path);
    if (!doc) {
      unavailable.push(path);
      continue;
    }
    for (const p of doc.passages || []) passages[p.id] = { ...p, date: doc.date || null };
  }
  for (const path of ordered) {
    const doc = docs.get(path);
    if (!doc) continue;
    const date = doc.date || null;
    let playable = 0;
    for (const question of doc.questions) {
      if (q[question.id] || (question.passage && !passages[question.passage])) continue;
      const item = { ...question, date, file: path };
      q[item.id] = item;
      list.push(item);
      if (item.passage) (groups[item.passage] ||= []).push(item.id);
      playable++;
    }
    for (const kind of ['grammar', 'vocab']) {
      for (const c of doc.learn?.[kind] || []) learn.push({ ...c, kind, date });
    }
    if (date && playable) {
      const report = typeof doc.report === 'string' ? doc.report : '';
      daily[date] = { date, report, focus: Array.isArray(doc.focus) ? doc.focus : [] };
    }
  }
  return { passages, q, groups, daily, list, learn, unavailable };
}

export async function loadData({ today = contentDateJst(), questionIds = [], learnedDates = [] } = {}) {
  const index = await getJSON('index.json');
  if (!validIndex(index)) throw new Error('Invalid study index');
  index.bank = [...new Set(index.bank)];
  index.daily = [...new Set(index.daily)].sort();
  const available = index.daily.filter(d => d <= today);
  const retained = new Set(learnedDates);
  const questionDays = new Set([...questionIds]
    .map(id => typeof id === 'string' && id.match(/^d(\d{4})-/)?.[1]).filter(Boolean));
  for (const date of available) {
    if (questionDays.has(date.slice(5).replace('-', ''))) retained.add(date);
  }
  for (const date of available.slice(-RECENT_PACKS)) retained.add(date);
  const files = [...index.bank, ...available.filter(d => retained.has(d)).map(dailyPath)];
  const [entries, changelog] = await Promise.all([
    fetchDocuments(files),
    getJSON('changelog.json').then(c => Array.isArray(c?.entries) ? c.entries : []).catch(() => []),
  ]);
  const next = new Map(entries);
  const assembled = assemble(next, index);
  if (!assembled.list.length) throw new Error('No usable question packs');
  documents = next;
  loadedThrough = today;
  Object.assign(DB, assembled, { index, changelog, latestIndexedDate: available.at(-1) || null });
  return DB;
}

export function hasMoreArchive() {
  return Boolean(DB.index?.daily.some(date => date <= loadedThrough && !documents.get(dailyPath(date))));
}

export async function loadArchive() {
  if (!DB.index || !hasMoreArchive()) return DB;
  if (archiveLoad) return archiveLoad;
  const index = DB.index;
  const target = documents;
  const paths = index.daily.filter(date => date <= loadedThrough && !target.get(dailyPath(date))).map(dailyPath);
  archiveLoad = (async () => {
    // Cap concurrent requests when opening an older archive.
    for (let start = 0; start < paths.length; start += 8) {
      for (const [path, doc] of await fetchDocuments(paths.slice(start, start + 8))) target.set(path, doc);
    }
    if (target === documents) Object.assign(DB, assemble(target, index));
    return DB;
  })();
  try {
    return await archiveLoad;
  } finally {
    archiveLoad = null;
  }
}

// Most recent playable daily file on or before date.
export function latestDaily(date) {
  const ds = Object.keys(DB.daily).filter(d => d <= date).sort();
  return ds.length ? DB.daily[ds.at(-1)] : null;
}

export function contentStatus(today = contentDateJst()) {
  const date = latestDaily(today)?.date || null;
  const indexed = DB.index?.daily.includes(today);
  return {
    state: date === today ? 'current' : date ? 'stale' : 'missing',
    reason: date === today ? null : indexed ? 'pack-unavailable' : 'not-published',
    date,
    unavailable: [...DB.unavailable],
  };
}

export function learnFor(date) {
  const dates = DB.learn.map(c => c.date).filter(d => d && d <= date).sort();
  const latest = dates.at(-1);
  return { date: latest || null, cards: DB.learn.filter(c => c.date === latest) };
}
