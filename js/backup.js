// Shared schema for local progress and manual backups. Only known fields are copied
// so old credentials and connection metadata cannot be reintroduced by an import.
export const BACKUP_KIND = 'n1-daily-backup';
export const BACKUP_VERSION = 2;
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

const invalid = () => { throw new Error('バックアップの形式が正しくありません。'); };
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, max = 256) => typeof x === 'string' && x.length > 0 && x.length <= max;
const key = x => text(x, 128) && !Object.hasOwn(Object.prototype, x) && x !== 'prototype';
const stamp = x => Number.isSafeInteger(x) && x > 0 && x <= 8640000000000000;
const count = x => Number.isSafeInteger(x) && x >= 0;
const flag = x => x === 0 || x === 1 || typeof x === 'boolean';
const goal = x => Number.isInteger(x) && x > 0 && x <= 500;
const midnight = d => Date.parse(d + 'T00:00:00Z');
const date = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  && Number.isFinite(midnight(d)) && new Date(midnight(d)).toISOString().slice(0, 10) === d;
const read = (value, test) => test(value) ? value : invalid();

function copyFields(target, source, fields) {
  for (const [name, test] of Object.entries(fields)) {
    if (Object.hasOwn(source, name)) target[name] = read(source[name], test);
  }
  return target;
}

function list(value, map) {
  if (value === undefined) return [];
  return read(value, Array.isArray).map(x => map(read(x, record)));
}

function dict(value, testKey, map) {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(read(value, record)).map(([k, v]) => [read(k, testKey), map(v)]));
}

function common(source, legacyId) {
  const t = read(source.t, stamp);
  return {
    rid: source.rid === undefined ? legacyId : read(source.rid, x => text(x, 512)),
    t,
    d: read(source.d, date),
  };
}

function attempt(source) {
  const id = read(source.id, key);
  const out = {
    ...common(source, `legacy:answer:${source.t}:${id}`),
    id,
    ok: Number(read(source.ok, flag)),
    // v10's delayed order submission could serialize a missing choice.
    ch: source.ch == null ? null : read(source.ch, count),
    ms: read(source.ms, count),
    updatedAt: source.updatedAt === undefined ? source.t : read(source.updatedAt, stamp),
  };
  return copyFields(out, source, { rt: flag, lk: flag, pt: count, pl: count, assisted: flag, roundId: key });
}

function event(source) {
  const k = read(source.k, key);
  const out = { ...common(source, `legacy:event:${source.t}:${k}:${source.m || ''}`), k };
  return copyFields(out, source, {
    m: key, n: count, fin: flag, a: count, c: count, of: count,
    miss: count, ms: count, ids: x => Array.isArray(x) && x.every(key),
    roundId: key, priorityDate: date,
  });
}

function feedback(source) {
  const out = { ...common(source, `legacy:feedback:${source.t}:${source.id || ''}`), text: read(source.text, x => text(x, 1000)) };
  return copyFields(out, source, { id: key });
}

function settings(value, defaults) {
  if (value === undefined) return { ...defaults };
  return copyFields({ ...defaults }, read(value, record), {
    daily: goal,
    showEn: x => typeof x === 'boolean',
    mincho: x => typeof x === 'boolean',
    big: x => typeof x === 'boolean',
    examMode: x => typeof x === 'boolean',
    sound: x => typeof x === 'boolean',
    rate: x => typeof x === 'number' && x >= 0.7 && x <= 1.3,
    voiceF: x => typeof x === 'string' && x.length <= 256,
    voiceM: x => typeof x === 'string' && x.length <= 256,
  });
}

function plan(source) {
  const p = read(source, record);
  const ids = read(p.ids, x => Array.isArray(x) && x.every(key));
  const pos = read(p.pos, x => count(x) && x <= ids.length);
  return { ids, pos, rounds: p.rounds === undefined ? 0 : read(p.rounds, count) };
}

export function learnedFromVersions(versions) {
  return Object.fromEntries(Object.entries(versions)
    .filter(([, v]) => v.date !== null)
    .map(([id, v]) => [id, v.date]));
}

// Equal legacy revisions retain the current record. New edits always advance their
// revision, including removing a mark or unmarking a learned card.
function newest(current, incoming) {
  return !current || incoming.updatedAt > current.updatedAt ? incoming : current;
}

function mergeList(current, incoming, resolve) {
  const records = new Map(current.map(x => [x.rid, x]));
  for (const x of incoming) records.set(x.rid, resolve(records.get(x.rid), x));
  return [...records.values()].sort((a, b) => a.t - b.t);
}

const first = (a, b) => a || b;

export function progressState(source, base) {
  read(source, record);
  if (!Array.isArray(source.log)) invalid();
  if (source.schema !== undefined && source.schema !== BACKUP_VERSION) invalid();

  const prefs = settings(source.settings, base.settings);
  const learned = dict(source.learned, key, d => read(d, date));
  const versions = dict(source.learnedVersions, key, x => {
    read(x, record);
    return { date: x.date === null ? null : read(x.date, date), updatedAt: read(x.updatedAt, stamp) };
  });
  // Old states represent only currently checked cards.
  for (const [id, d] of Object.entries(learned)) {
    if (!Object.hasOwn(versions, id)) versions[id] = { date: d, updatedAt: Math.max(1, midnight(d)) };
  }
  return {
    schema: BACKUP_VERSION,
    deviceId: source.deviceId === undefined ? base.deviceId : read(source.deviceId, key),
    created: source.created === undefined ? base.created : read(source.created, date),
    settings: prefs,
    log: mergeList([], list(source.log, attempt), newest),
    events: mergeList([], list(source.events, event), first),
    feedback: mergeList([], list(source.feedback, feedback), first),
    learned: learnedFromVersions(versions),
    learnedVersions: versions,
    plans: dict(source.plans, date, x => dict(x, key, plan)),
    goals: dict(source.goals, date, x => read(x, goal)),
    historyGoal: source.historyGoal === undefined ? prefs.daily : read(source.historyGoal, goal),
  };
}

export function readBackup(source, base, mode) {
  if (source?.kind === BACKUP_KIND) {
    if (source.version !== BACKUP_VERSION) invalid();
    return progressState(source.state, base);
  }
  if (Array.isArray(source?.attempts)) {
    // A legacy per-device, per-day GitHub progress file, provided locally.
    if (mode === 'replace') throw new Error('1日分の記録は「現在の記録に追加」で読み込んでください。');
    const d = read(source.date, date);
    const learned = Object.fromEntries(read(source.learned ?? [], Array.isArray).map(id => [read(id, key), d]));
    return progressState({ created: d, log: source.attempts, events: source.events, feedback: source.feedback, learned }, base);
  }
  return progressState(source, base);
}

export function mergeProgress(current, incoming, today) {
  const learnedVersions = { ...current.learnedVersions };
  for (const [id, v] of Object.entries(incoming.learnedVersions)) {
    learnedVersions[id] = newest(learnedVersions[id], v);
  }
  const plans = { ...current.plans };
  for (const [d, p] of Object.entries(incoming.plans)) plans[d] = { ...p, ...plans[d] };
  const goals = { ...incoming.goals, ...current.goals };
  // Preserve the original fallback for each source's historical activity.
  for (const s of [current, incoming]) {
    for (const { d } of [...s.log, ...s.events, ...s.feedback]) {
      if (d < today && !Object.hasOwn(goals, d)) goals[d] = s.historyGoal;
    }
    for (const d of Object.values(s.learned)) {
      if (d < today && !Object.hasOwn(goals, d)) goals[d] = s.historyGoal;
    }
  }
  return {
    ...current,
    created: current.created < incoming.created ? current.created : incoming.created,
    log: mergeList(current.log, incoming.log, newest),
    events: mergeList(current.events, incoming.events, first),
    feedback: mergeList(current.feedback, incoming.feedback, first),
    learned: learnedFromVersions(learnedVersions),
    learnedVersions,
    plans,
    goals,
  };
}
