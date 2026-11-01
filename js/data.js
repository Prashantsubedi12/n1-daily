// Loads every question file listed in data/index.json into one in-memory DB.

export const DB = {
  index: null,
  q: {},          // id -> question
  list: [],       // all questions in file order
  passages: {},   // id -> passage
  groups: {},     // passage id -> [question ids] in order
  learn: [],      // learn cards (grammar + vocab), each with .date
  daily: {},      // date -> {report, focus}
  changelog: [],  // app updates by the improver agent, newest first
};

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export async function loadData() {
  const index = await getJSON('data/index.json');
  DB.index = index;
  const files = [...(index.bank || []), ...(index.daily || []).map(d => `daily/${d}.json`)];
  const docs = await Promise.all(
    files.map(f => getJSON('data/' + f).then(doc => ({ f, doc })).catch(err => {
      console.warn('could not load', f, err);
      return null;
    })),
  );
  for (const item of docs) {
    if (!item) continue;
    const { f, doc } = item;
    const date = doc.date || null;
    for (const p of doc.passages || []) DB.passages[p.id] = { ...p, date };
    for (const q of doc.questions || []) {
      if (DB.q[q.id]) continue;
      const qq = { ...q, date, file: f };
      DB.q[q.id] = qq;
      DB.list.push(qq);
    }
    for (const c of doc.learn?.grammar || []) DB.learn.push({ ...c, kind: 'grammar', date });
    for (const c of doc.learn?.vocab || []) DB.learn.push({ ...c, kind: 'vocab', date });
    if (date) DB.daily[date] = { date, report: doc.report || '', focus: doc.focus || [] };
  }
  for (const q of DB.list) {
    if (q.passage) (DB.groups[q.passage] ||= []).push(q.id);
  }
  DB.changelog = await getJSON('data/changelog.json').then(c => c.entries || []).catch(() => []);
  return DB;
}

// Most recent daily file on or before `date`.
export function latestDaily(date) {
  const ds = Object.keys(DB.daily).filter(d => d <= date).sort();
  return ds.length ? DB.daily[ds[ds.length - 1]] : null;
}

export function learnFor(date) {
  const ds = [...new Set(DB.learn.map(c => c.date))].filter(d => d && d <= date).sort();
  const d = ds[ds.length - 1];
  return { date: d || null, cards: DB.learn.filter(c => c.date === d) };
}
