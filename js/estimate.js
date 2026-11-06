// Evidence from first-ever N1 attempts, shared by the app and the daily analyzer.
// This is observed practice accuracy. JLPT scores use a separate scaled system.
export const MIN_ANSWERS = 8;
export const MIN_TYPES = 2;
export const MIN_PASSAGES = 3;

const SEC = { reading: 'read', listening: 'listen' };

export function firstAttemptEvidence(attempts, questions, since = '0000-00-00') {
  const blank = () => ({ n: 0, correct: 0, types: new Set(), passages: new Set() });
  const sections = { lang: blank(), read: blank(), listen: blank() };
  const seen = new Set();
  for (const a of [...attempts].sort((a, b) => a.t - b.t)) {
    if (a.rt || seen.has(a.id)) continue;
    seen.add(a.id);
    const q = questions[a.id];
    if (a.d < since || a.assisted || q?.level !== 'N1') continue;
    const section = sections[SEC[q.type] || 'lang'];
    section.n++;
    if (a.ok && !a.lk) section.correct++;
    section.types.add(q.sub || q.type);
    if (q.passage) section.passages.add(q.passage);
  }

  for (const [key, section] of Object.entries(sections)) {
    const { n, correct, types, passages } = section;
    const enough = n >= MIN_ANSWERS && types.size >= MIN_TYPES && (key !== 'read' || passages.size >= MIN_PASSAGES);
    sections[key] = { n, correct, types: types.size, passages: passages.size, accuracy: enough ? correct / n : null };
  }
  return sections;
}
