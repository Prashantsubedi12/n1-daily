// Rough JLPT N1 score estimate from practice accuracy. Pure (no DOM / storage),
// so the app (engine.js) and the nightly analysis (tools/analyze.mjs) share one formula.
//
// Each section is 0–60. Accuracy per question type is weighted by how many items that
// type has on the real test, then scaled to 60. Types with few attempts are pulled toward
// the section average so one lucky answer doesn't swing the estimate.

export const PASS = { section: 19, total: 100 };

// Approximate item counts per type on the current N1 test.
const ITEMS = {
  lang: { kanji: 6, context: 7, paraphrase: 6, usage: 6, grammar: 10, order: 5, textgrammar: 5 },
  read: { 'reading:short': 4, 'reading:mid': 9, 'reading:long': 4, 'reading:integrated': 2, 'reading:opinion': 4, 'reading:info': 2 },
  listen: { 'listening:task': 5, 'listening:point': 6, 'listening:summary': 5, 'listening:response': 11, 'listening:integrated': 3 },
};

const SEC = { reading: 'read', listening: 'listen' };
const PRIOR_WEIGHT = 4;
// Below this many answers in a section the estimate is shown as "not enough data".
export const MIN_ANSWERS = 8;

const keyOf = q => (q.type === 'reading' || q.type === 'listening' ? `${q.type}:${q.sub}` : q.type);

// attempts: [{id, ok, lk?, rt?, d}] · questions: id -> {type, sub} · since: 'YYYY-MM-DD'
export function estimateScores(attempts, questions, since = '0000-00-00') {
  const by = { lang: {}, read: {}, listen: {} };
  const secTot = { lang: { n: 0, c: 0 }, read: { n: 0, c: 0 }, listen: { n: 0, c: 0 } };
  for (const a of attempts) {
    if (a.rt || a.d < since) continue;
    const q = questions[a.id];
    if (!q) continue;
    const sec = SEC[q.type] || 'lang';
    const good = a.ok && !a.lk ? 1 : 0;
    const k = keyOf(q);
    const t = (by[sec][k] ||= { n: 0, c: 0 });
    t.n++;
    t.c += good;
    secTot[sec].n++;
    secTot[sec].c += good;
  }

  const sections = {};
  for (const sec of ['lang', 'read', 'listen']) {
    const tot = secTot[sec];
    if (tot.n < MIN_ANSWERS) {
      sections[sec] = { score: null, n: tot.n };
      continue;
    }
    const prior = tot.c / tot.n;
    let sum = 0;
    let weight = 0;
    for (const [k, items] of Object.entries(ITEMS[sec])) {
      const t = by[sec][k] || { n: 0, c: 0 };
      sum += items * ((t.c + PRIOR_WEIGHT * prior) / (t.n + PRIOR_WEIGHT));
      weight += items;
    }
    sections[sec] = { score: Math.round((sum / weight) * 60), n: tot.n };
  }

  const scores = Object.values(sections).map(s => s.score);
  const total = scores.every(s => s != null) ? scores.reduce((x, y) => x + y, 0) : null;
  const pass = total != null && total >= PASS.total && scores.every(s => s >= PASS.section);
  return { sections, total, pass };
}
