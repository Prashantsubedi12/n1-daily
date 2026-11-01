// Pushes this device's attempt log to the repo's `progress` branch (one file per day per device)
// so the daily question generator can analyse it. Uses a fine-grained token the user pastes in 設定.

import { getState, save, mergeLog, APP_VERSION } from './store.js';

const API = 'https://api.github.com';

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function cfg() {
  const s = getState().settings;
  return { token: s.ghToken.trim(), repo: s.ghRepo.trim(), branch: s.ghBranch.trim() || 'progress' };
}

async function gh(path, opts = {}) {
  const { token } = cfg();
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return res;
}

export function configured() {
  const { token, repo } = cfg();
  return !!(token && repo);
}

const NOT_SET = 'トークンが空です：GitHubで作ったトークン（github_pat_…）を貼り付けてください';

// Turns a failed GitHub response into a Japanese hint about which token setting is wrong.
async function explain(res) {
  let detail = '';
  try {
    detail = (await res.json()).message || '';
  } catch {}
  if (res.status === 401) return '認証エラー：トークンが無効か期限切れです。作り直してください';
  // GitHub answers 403 or 404 both when the repo isn't selected and when Contents is read-only
  if (res.status === 403 || res.status === 404)
    return `書き込み不可（${res.status}）：トークンの Repository access で n1-daily を選び、Contents を「Read and write」にしてください`;
  return `エラー ${res.status} ${detail}`;
}

// Public repos are readable with any token, so only a real write proves the token can sync.
export async function testConnection() {
  if (!configured()) return NOT_SET;
  const { repo, branch } = cfg();
  const st = getState();
  const path = `progress/.ping-${st.deviceId}`;
  const cur = await gh(`/repos/${repo}/contents/${path}?ref=${branch}`);
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const r = await gh(`/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message: 'sync test', content: b64encode(new Date().toISOString()), branch, ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) return explain(r);
  return 'OK：書き込みできます';
}

// Everything this device recorded on one day: answers, app events, feedback and 覚えた cards.
function dayRecord(date) {
  const st = getState();
  return {
    attempts: st.log.filter(e => e.d === date && !e.r).map(({ r, ...e }) => e),
    events: st.events.filter(e => e.d === date),
    feedback: st.feedback.filter(f => f.d === date),
    learned: Object.keys(st.learned).filter(id => st.learned[id] === date),
  };
}

const size = rec => rec.attempts.length + rec.events.length + rec.feedback.length + rec.learned.length;

function pendingDates() {
  const st = getState();
  const dates = new Set([...st.log.filter(e => !e.r), ...st.events, ...st.feedback].map(e => e.d));
  for (const d of Object.values(st.learned)) dates.add(d);
  return [...dates].filter(d => st.sync.counts[d] !== size(dayRecord(d))).sort();
}

export function hasPending() {
  return pendingDates().length > 0;
}

// Answers recorded on this browser (iOS home-screen apps have storage separate from Safari).
export function localCount() {
  return getState().log.filter(e => !e.r).length;
}

async function putDay(date) {
  const st = getState();
  const { repo, branch } = cfg();
  const path = `progress/${date}_${st.deviceId}.json`;
  const rec = dayRecord(date);
  const body = { device: st.deviceId, date, app: APP_VERSION, ...rec };
  const content = b64encode(JSON.stringify(body));
  const put = sha =>
    gh(`/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `progress ${date} (${rec.attempts.length})`, content, branch, ...(sha ? { sha } : {}) }),
    });
  let res = await put(st.sync.shas[date]);
  if (res.status === 409 || res.status === 422) {
    // Our stored sha is stale (or missing) — fetch the current one and retry once.
    const cur = await gh(`/repos/${repo}/contents/${path}?ref=${branch}`);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    res = await put(sha);
  }
  if (!res.ok) throw new Error(await explain(res));
  const json = await res.json();
  st.sync.shas[date] = json.content.sha;
  st.sync.counts[date] = size(rec);
}

let running = false;

export async function syncNow() {
  if (!configured()) return { ok: false, msg: NOT_SET };
  if (running) return { ok: false, msg: '同期中' };
  if (!navigator.onLine) return { ok: false, msg: 'オフライン' };
  running = true;
  const st = getState();
  try {
    const dates = pendingDates();
    for (const d of dates) await putDay(d);
    st.sync.last = Date.now();
    st.sync.error = '';
    save();
    const mine = localCount();
    return { ok: true, msg: dates.length ? `${dates.length}日分を同期しました（この端末の解答 ${mine}問）` : `最新です（この端末の解答 ${mine}問）` };
  } catch (e) {
    // fetch itself throws (iOS: "Load failed") when the request never reached GitHub
    const msg = e instanceof TypeError ? `通信エラー：${e.message}` : e.message;
    st.sync.error = msg;
    save();
    return { ok: false, msg };
  } finally {
    running = false;
  }
}

// Pulls every device's progress files and merges them into the local log.
export async function restore() {
  const { repo, branch } = cfg();
  const list = await gh(`/repos/${repo}/contents/progress?ref=${branch}`);
  if (list.status === 404) return 0;
  if (!list.ok) throw new Error(`復元エラー ${list.status}`);
  const files = (await list.json()).filter(f => f.name.endsWith('.json'));
  const st = getState();
  const entries = [];
  for (const f of files) {
    const r = await gh(`/repos/${repo}/contents/${f.path}?ref=${branch}`);
    if (!r.ok) continue;
    const meta = await r.json();
    const doc = JSON.parse(b64decode(meta.content));
    if (doc.device === st.deviceId) {
      st.sync.shas[doc.date] = meta.sha;
      st.sync.counts[doc.date] = size({ attempts: [], events: [], feedback: [], learned: [], ...doc });
      continue;
    }
    entries.push(...(doc.attempts || []));
  }
  return mergeLog(entries);
}
