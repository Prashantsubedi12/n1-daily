// Persistent state (localStorage). The attempt log is the source of truth;
// spaced-repetition state is derived from it so a backup restore rebuilds it.

import {
  BACKUP_KIND, BACKUP_VERSION, MAX_BACKUP_BYTES, progressState, readBackup, mergeProgress,
} from './backup.js';

const KEY = 'n1daily.v1';
const RECOVERY = 'n1daily.recovery';
// Days until the next review, indexed by Leitner box (0 = just missed).
const INTERVALS = [1, 2, 4, 7, 15, 30];

export const EXAM_DATE = '2026-12-06';
// Shown in 設定 so we can tell which code a phone is running. Bump together with VERSION in sw.js.
export const APP_VERSION = 'v12';

function defaults() {
  return {
    schema: BACKUP_VERSION,
    deviceId: recordId(),
    created: todayStr(),
    settings: {
      daily: 50,
      showEn: true,
      mincho: false,
      big: false,
      examMode: false,
      sound: true,
      rate: 1.0,
      voiceF: '',
      voiceM: '',
    },
    log: [],      // {rid, id, ok, ch, ms, t, d, updatedAt, rt?, lk?, pt?, pl?}
    events: [],   // {rid, k, t, d, ...} — local study activity
    feedback: [], // {rid, t, d, text, id?} — local notes; id = reported question
    learned: {},  // learn-card id -> date
    learnedVersions: {}, // learn-card id -> {date (null when unchecked), updatedAt}
    plans: {},    // date -> menu key -> {ids, pos, rounds}
    activeQuiz: null,
    goals: {},    // date -> goal used that day
    historyGoal: 50, // stable fallback for legacy history
  };
}

let state = null;
let storedState = null;
let revision = 0;
let persistenceError = '';
let blockedByUnreadableState = false;
let srsCache = null;
let srsKey = '';

function recordId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setPersistenceError(message) {
  if (persistenceError === message) return;
  persistenceError = message;
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('n1daily:persistence-error', { detail: message }));
  }
}

export function load() {
  const base = defaults();
  blockedByUnreadableState = false;
  state = base;
  storedState = null;
  revision++;
  try {
    const raw = storedState = localStorage.getItem(KEY);
    if (!raw) {
      setPersistenceError('');
      return state;
    }
    const saved = JSON.parse(raw);
    const migrated = progressState(saved, base);
    const activeQuiz = Number.isInteger(saved.activeQuiz?.version) ? saved.activeQuiz : null;
    state = { ...migrated, activeQuiz };
    prunePlans();
    if (JSON.stringify(state) !== raw) save();
  } catch {
    blockedByUnreadableState = true;
    setPersistenceError('保存済みの記録を読み込めません。記録は上書きせずに保護されています。');
  }
  return state;
}

const WRITE_ERROR = 'この端末に保存できませんでした。設定からバックアップを保存してください。';
const WRITE_CONFLICT = '別のタブで学習記録が更新されました。このタブの記録をバックアップし、再読み込みしてから追加してください。';

function writeState(next) {
  const raw = JSON.stringify(next);
  if (localStorage.getItem(KEY) !== storedState) throw new Error(WRITE_CONFLICT);
  localStorage.setItem(KEY, raw);
  storedState = raw;
}

export function save() {
  revision++;
  if (blockedByUnreadableState) return false;
  try {
    writeState(state);
    setPersistenceError('');
    return true;
  } catch (err) {
    setPersistenceError(err.message === WRITE_CONFLICT ? WRITE_CONFLICT : WRITE_ERROR);
    return false;
  }
}

export const getPersistenceError = () => persistenceError;
export const getStateRevision = () => revision;

export function getState() {
  return state;
}

export function backupJSON() {
  const data = progressState(state, defaults());
  return JSON.stringify({ kind: BACKUP_KIND, version: BACKUP_VERSION, state: data });
}

function applyImport(next) {
  let previousRecovery;
  let wroteRecovery = false;
  try {
    if (!blockedByUnreadableState) {
      previousRecovery = localStorage.getItem(RECOVERY);
      localStorage.setItem(RECOVERY, backupJSON());
      wroteRecovery = true;
    }
    writeState(next);
  } catch (err) {
    if (wroteRecovery) {
      try {
        if (previousRecovery === null) localStorage.removeItem(RECOVERY);
        else localStorage.setItem(RECOVERY, previousRecovery);
      } catch {
        // The current progress is still available in memory and in KEY.
      }
    }
    if (err.message === WRITE_CONFLICT) throw err;
    throw new Error('容量または端末の設定により復元できませんでした。現在の記録は保持されています。');
  }
  state = next;
  revision++;
  blockedByUnreadableState = false;
  setPersistenceError('');
}

export function importBackup(raw, mode = 'merge') {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) {
    throw new Error('バックアップは8 MB以下のJSONファイルを選んでください。');
  }
  const base = defaults();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSONファイルを読み込めません。');
  }
  const incoming = readBackup(parsed, base, mode);
  if (mode === 'replace') {
    applyImport({ ...incoming, deviceId: state.deviceId, activeQuiz: null });
  } else if (mode === 'merge') {
    applyImport(mergeProgress(state, incoming, todayStr()));
  } else {
    throw new Error('復元方法を選んでください。');
  }
}

export function hasRecoveryBackup() {
  try {
    return !!localStorage.getItem(RECOVERY);
  } catch {
    return false;
  }
}

export function restoreRecoveryBackup() {
  const raw = localStorage.getItem(RECOVERY);
  if (!raw) throw new Error('復元前の記録が見つかりません。');
  importBackup(raw, 'replace');
}

export function resetProgress() {
  applyImport({ ...defaults(), deviceId: state.deviceId, settings: { ...state.settings }, historyGoal: state.settings.daily });
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

export function goalFor(d) {
  return d === todayStr() ? state.settings.daily : state.goals[d] ?? state.historyGoal;
}

function snapshotGoal(d) {
  state.goals[d] = state.settings.daily;
}

export function setDailyGoal(goal) {
  state.settings.daily = goal;
  state.goals[todayStr()] = goal;
  return save();
}

export function recordAttempt({ id, ok, ch, ms, rt, pt, pl, assisted, attemptId, roundId }, { persist = true } = {}) {
  const existing = attemptId && state.log.find(e => e.rid === attemptId);
  if (existing) return existing;
  const t = Date.now();
  const d = todayStr();
  const e = { rid: attemptId || recordId(), id, ok: ok ? 1 : 0, ch, ms: Math.round(ms), t, d, updatedAt: t };
  if (rt) e.rt = 1;
  if (pt) e.pt = Math.round(pt);
  if (pl !== undefined) e.pl = pl;
  if (assisted) e.assisted = 1;
  if (roundId) e.roundId = roundId;
  state.log.push(e);
  snapshotGoal(d);
  if (persist) save();
  return e;
}

export function logEvent(k, data = {}, { eventId, persist = true } = {}) {
  const existing = eventId && state.events.find(e => e.rid === eventId);
  if (existing) return existing;
  const d = todayStr();
  const e = { ...data, rid: eventId || recordId(), k, t: Date.now(), d };
  state.events.push(e);
  snapshotGoal(d);
  if (persist) save();
  return e;
}

export function addFeedback(text, id) {
  const f = { rid: recordId(), t: Date.now(), d: todayStr(), text };
  if (id) f.id = id;
  state.feedback.push(f);
  save();
  return f;
}

function editTime(previous) {
  return Math.max(Date.now(), previous + 1);
}

function findAttempt(ref) {
  return state.log.find(e => typeof ref === 'string' ? e.rid === ref : e.t === ref);
}

export function setLucky(ref, lucky, { persist = true } = {}) {
  const e = findAttempt(ref);
  if (!e) return;
  if (lucky) e.lk = 1;
  else delete e.lk;
  e.updatedAt = editTime(e.updatedAt);
  if (persist) save();
}

export function setPassageTime(ref, pt) {
  const e = findAttempt(ref);
  if (e) {
    e.pt = Math.round(pt);
    e.updatedAt = editTime(e.updatedAt);
    save();
  }
}

export function setLearned(id, checked) {
  const d = todayStr();
  const prior = state.learnedVersions[id];
  if (!!prior?.date === checked) return;
  if (checked) state.learned[id] = d;
  else delete state.learned[id];
  state.learnedVersions[id] = { date: checked ? d : null, updatedAt: editTime(prior?.updatedAt ?? 0) };
  snapshotGoal(d);
  return save();
}

// Spaced-repetition state per question, replayed from the log.
export function srs() {
  const key = state.log.length + ':' + revision;
  if (srsCache && srsKey === key) return srsCache;
  const m = {};
  for (const e of state.log) {
    if (e.rt || e.assisted) continue;
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
