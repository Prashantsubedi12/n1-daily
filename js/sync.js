// Sends this device's study record to the repo's `progress` branch (one file per day per device)
// so the nightly question generator and improver can read it.
//
// The token and sync bookkeeping live under their own localStorage key, never inside the
// progress state, so backups stay token-free and a backup import can't overwrite them.

import { getState, APP_VERSION } from './store.js';

const API = 'https://api.github.com';
const KEY = 'n1daily.sync';
const DEFAULTS = { token: '', repo: 'Prashantsubedi12/n1-daily', branch: 'progress', hashes: {}, shas: {}, last: 0, error: '' };

let conf = null;

function cfg() {
  if (conf) return conf;
  try {
    conf = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    conf = { ...DEFAULTS };
  }
  return conf;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg()));
  } catch {
    // Sync still works this session; it just re-sends next time.
  }
}

export function syncInfo() {
  const c = cfg();
  return { configured: !!c.token, last: c.last, error: c.error };
}

export function setToken(token) {
  const c = cfg();
  if (c.token === token) return;
  c.token = token;
  c.error = '';
  persist();
}

export function hasToken() {
  return !!cfg().token;
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function gh(path, opts = {}) {
  return fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg().token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

const NOT_SET = 'トークンが空です：GitHubで作ったトークン（github_pat_…）を貼り付けてください';

// Turns a failed GitHub response into a Japanese hint about which token setting is wrong.
async function explain(res) {
  let detail = '';
  try {
    detail = (await res.json()).message || '';
  } catch {}
  if (res.status === 401) return '認証エラー：トークンが無効か期限切れです。作り直してください';
  // GitHub answers 403 or 404 both when the repo isn't selected and when Contents is read-only.
  if (res.status === 403 || res.status === 404)
    return `書き込み不可（${res.status}）：トークンの Repository access で n1-daily を選び、Contents を「Read and write」にしてください`;
  return `エラー ${res.status} ${detail}`;
}

async function currentSha(path) {
  const { repo, branch } = cfg();
  const r = await gh(`/repos/${repo}/contents/${path}?ref=${branch}`);
  return r.ok ? (await r.json()).sha : undefined;
}

function put(path, message, text, sha) {
  const { repo, branch } = cfg();
  return gh(`/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64encode(text), branch, ...(sha ? { sha } : {}) }),
  });
}

// The repo is public, so reading proves nothing — only a real write shows the token can sync.
export async function testConnection() {
  if (!hasToken()) return NOT_SET;
  const path = `progress/.ping-${getState().deviceId}`;
  const r = await put(path, 'sync test', new Date().toISOString(), await currentSha(path));
  if (!r.ok) return explain(r);
  return 'OK：書き込みできます';
}

// Everything recorded on one day on this device: answers, app events, notes and 覚えた cards.
function dayRecord(date) {
  const st = getState();
  return {
    attempts: st.log.filter(e => e.d === date),
    events: st.events.filter(e => e.d === date),
    feedback: st.feedback.filter(f => f.d === date),
    learned: Object.keys(st.learned).filter(id => st.learned[id] === date),
  };
}

// Cheap fingerprint so edits (⚑ notes, lucky marks, unchecking a card) re-send the day, not just new rows.
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}:${h >>> 0}`;
}

function days() {
  const st = getState();
  const dates = new Set([...st.log, ...st.events, ...st.feedback].map(e => e.d));
  for (const d of Object.values(st.learned)) dates.add(d);
  for (const d of Object.keys(cfg().hashes)) dates.add(d); // a day whose cards were all unchecked
  return [...dates].sort();
}

function pending() {
  const { hashes } = cfg();
  return days()
    .map(d => [d, JSON.stringify(dayRecord(d))])
    .filter(([d, json]) => hashes[d] !== hash(json));
}

export function hasPending() {
  return hasToken() && pending().length > 0;
}

async function putDay(date, json) {
  const c = cfg();
  const st = getState();
  const path = `progress/${date}_${st.deviceId}.json`;
  const rec = JSON.parse(json);
  const body = JSON.stringify({ device: st.deviceId, date, app: APP_VERSION, ...rec });
  const message = `progress ${date} (${rec.attempts.length})`;
  let res = await put(path, message, body, c.shas[date]);
  if (res.status === 409 || res.status === 422) {
    // Our stored sha is stale or missing (e.g. after v13 cleared it) — fetch the current one and retry once.
    res = await put(path, message, body, await currentSha(path));
  }
  if (!res.ok) throw new Error(await explain(res));
  c.shas[date] = (await res.json()).content.sha;
  c.hashes[date] = hash(json);
  persist();
}

let running = null;

export function syncNow() {
  if (!hasToken()) return Promise.resolve({ ok: false, msg: NOT_SET });
  if (running) return running;
  if (!navigator.onLine) return Promise.resolve({ ok: false, msg: 'オフライン：つながったら自動で送ります' });
  running = (async () => {
    const c = cfg();
    try {
      const todo = pending();
      for (const [d, json] of todo) await putDay(d, json);
      c.last = Date.now();
      c.error = '';
      persist();
      const n = getState().log.length;
      return { ok: true, msg: todo.length ? `${todo.length}日分を送信しました（この端末の解答 ${n}問）` : `最新です（この端末の解答 ${n}問）` };
    } catch (e) {
      // fetch itself throws (iOS: "Load failed") when the request never reached GitHub.
      c.error = e instanceof TypeError ? `通信エラー：${e.message}` : e.message;
      persist();
      return { ok: false, msg: c.error };
    }
  })();
  // Cleared after assignment: with nothing to send the body finishes synchronously, and a
  // `finally` inside it would run before `running` is set and leave it stuck forever.
  running.finally(() => {
    running = null;
  });
  return running;
}

let timer = 0;

// Called after anything that records study; batches bursts of answers into one send.
export function syncSoon(delay = 1500) {
  if (!hasToken()) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (hasPending()) syncNow();
  }, delay);
}
