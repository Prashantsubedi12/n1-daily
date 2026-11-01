// Persistent state (localStorage). The attempt log is the source of truth;
// spaced-repetition state is derived from it so a restore from GitHub rebuilds everything.

const KEY = 'n1daily.v1';
// Days until the next review, indexed by Leitner box (0 = just missed).
const INTERVALS = [1, 2, 4, 7, 15, 30];

export const EXAM_DATE = '2026-12-06';
// Shown in 設定 so we can tell which code a phone is running. Bump together with VERSION in sw.js.
export const APP_VERSION = 'v5';

function defaults() {
  return {
    deviceId: Math.random().toString(36).slice(2, 8),
    created: todayStr(),
    settings: {
      daily: 50,
      showEn: true,
      mincho: false,
      big: false,
      examMode: false,
      rate: 1.0,
      voiceF: '',
      voiceM: '',
      ghRepo: 'Prashantsubedi12/n1-daily',
      ghBranch: 'progress',
      ghToken: '',
    },
    log: [],      // {id, ok, ch, ms, t, d, rt?, lk?, pt?, r?}
    learned: {},  // learn-card id -> date
    plans: {},    // date -> menu key -> {ids, pos, rounds}
    sync: { shas: {}, counts: {}, last: 0, error: '' },
  };
}

let state = null;
let edits = 0;
let srsCache = null;
let srsKey = '';

export function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state = { ...base, ...saved, settings: { ...base.settings, ...saved.settings }, sync: { ...base.sync, ...saved.sync } };
    } else {
      state = base;
    }
  } catch {
    state = base;
  }
  prunePlans();
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function getState() {
  return state;
}

export function replaceState(next) {
  state = next;
  edits++;
  save();
}

// ---- dates (device local time = JST for the user) ----

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}

export function diffDays(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// ---- attempts ----

export function recordAttempt({ id, ok, ch, ms, rt, pt }) {
  const e = { id, ok: ok ? 1 : 0, ch, ms: Math.round(ms), t: Date.now(), d: todayStr() };
  if (rt) e.rt = 1;
  if (pt) e.pt = Math.round(pt);
  state.log.push(e);
  edits++;
  save();
  return e;
}

export function setLucky(t, lucky) {
  const e = state.log.find(x => x.t === t);
  if (!e) return;
  if (lucky) e.lk = 1;
  else delete e.lk;
  edits++;
  save();
}

export function setPassageTime(t, pt) {
  const e = state.log.find(x => x.t === t);
  if (e) {
    e.pt = Math.round(pt);
    save();
  }
}

export function mergeLog(entries) {
  const seen = new Set(state.log.map(e => e.t + '|' + e.id));
  let added = 0;
  for (const e of entries) {
    if (!e || !e.id || !e.t) continue;
    const k = e.t + '|' + e.id;
    if (seen.has(k)) continue;
    seen.add(k);
    state.log.push({ ...e, r: 1 });
    added++;
  }
  state.log.sort((a, b) => a.t - b.t);
  edits++;
  save();
  return added;
}

// Spaced-repetition state per question, replayed from the log.
export function srs() {
  const key = state.log.length + ':' + edits;
  if (srsCache && srsKey === key) return srsCache;
  const m = {};
  for (const e of state.log) {
    if (e.rt) continue;
    const s = m[e.id] || (m[e.id] = { n: 0, c: 0, box: -1, due: null, lastD: null, lastOk: false, wrongEver: false, lastWrongD: null, lastCh: null });
    const good = e.ok && !e.lk;
    s.n++;
    if (good) {
      s.c++;
      s.box = s.box < 0 ? 3 : Math.min(s.box + 1, INTERVALS.length - 1);
    } else {
      s.box = 0;
      s.wrongEver = true;
      s.lastWrongD = e.d;
      s.lastCh = e.ch;
    }
    s.due = addDays(e.d, INTERVALS[s.box]);
    s.lastD = e.d;
    s.lastOk = good;
  }
  srsCache = m;
  srsKey = key;
  return m;
}

export function isMastered(st) {
  return !!st && st.lastOk && st.box >= 3;
}

function prunePlans() {
  const keep = addDays(todayStr(), -3);
  for (const d of Object.keys(state.plans)) if (d < keep) delete state.plans[d];
}
