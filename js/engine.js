// Adaptive selection: what to ask next, based on accuracy by type, sub-type and tag.

import { DB } from './data.js';
import { getState, srs, todayStr, addDays, isMastered } from './store.js';
import { shuffle } from './util.js';

export const TYPES = {
  kanji:       { label: '漢字読み',       mondai: '問題1', sec: 'lang' },
  context:     { label: '文脈規定',       mondai: '問題2', sec: 'lang' },
  paraphrase:  { label: '言い換え類義',   mondai: '問題3', sec: 'lang' },
  usage:       { label: '用法',           mondai: '問題4', sec: 'lang' },
  grammar:     { label: '文法形式の判断', mondai: '問題5', sec: 'lang' },
  order:       { label: '文の組み立て',   mondai: '問題6', sec: 'lang' },
  textgrammar: { label: '文章の文法',     mondai: '問題7', sec: 'lang' },
  reading:     { label: '読解',           mondai: '読解',  sec: 'read' },
  listening:   { label: '聴解',           mondai: '聴解',  sec: 'listen' },
};

export const SUBS = {
  reading: {
    short: '内容理解（短文）',
    mid: '内容理解（中文）',
    long: '内容理解（長文）',
    integrated: '統合理解',
    opinion: '主張理解',
    info: '情報検索',
  },
  listening: {
    task: '課題理解',
    point: 'ポイント理解',
    summary: '概要理解',
    response: '即時応答',
  },
};

export const SECTIONS = { lang: '言語知識', read: '読解', listen: '聴解' };

const LANG_ROUND = ['kanji', 'context', 'paraphrase', 'usage', 'grammar', 'order'];

export const secOf = q => TYPES[q.type]?.sec || 'lang';

export function typeLabel(q) {
  const t = TYPES[q.type];
  if (!t) return q.type;
  const sub = SUBS[q.type]?.[q.sub];
  return sub ? `${t.label}・${sub}` : `${t.mondai} ${t.label}`;
}

// One pass over the log → accuracy by section / type / sub / tag / day.
export function aggregate(days = 14) {
  const since = days ? addDays(todayStr(), -(days - 1)) : '0000-00-00';
  const agg = { sec: {}, type: {}, sub: {}, tag: {}, day: {}, n: 0, c: 0 };
  const bump = (o, k, good) => {
    const a = (o[k] ||= { n: 0, c: 0 });
    a.n++;
    if (good) a.c++;
  };
  for (const e of getState().log) {
    if (e.rt) continue;
    const q = DB.q[e.id];
    if (!q) continue;
    const good = e.ok && !e.lk;
    bump(agg.day, e.d, good);
    if (e.d < since) continue;
    agg.n++;
    if (good) agg.c++;
    bump(agg.sec, secOf(q), good);
    bump(agg.type, q.type, good);
    if (q.sub) bump(agg.sub, q.type + ':' + q.sub, good);
    for (const t of q.tags || []) bump(agg.tag, t, good);
  }
  return agg;
}

export const rate = a => (a && a.n ? a.c / a.n : null);

export function weakTags(agg, limit = 12) {
  return Object.entries(agg.tag)
    .filter(([, a]) => a.n >= 2 && a.c / a.n < 0.75)
    .sort((x, y) => x[1].c / x[1].n - y[1].c / y[1].n || y[1].n - x[1].n)
    .slice(0, limit)
    .map(([tag, a]) => ({ tag, ...a }));
}

// Weaker types get picked more often (0.4 for a perfect type, up to 2.4 for 0%).
function typeWeight(agg, q) {
  const a = q.sub ? agg.sub[q.type + ':' + q.sub] : agg.type[q.type];
  const r = a && a.n >= 4 ? a.c / a.n : 0.6;
  return 0.4 + (1 - r) * 2;
}

function tagWeight(agg, q) {
  let w = 1;
  for (const t of q.tags || []) {
    const a = agg.tag[t];
    if (a && a.n > a.c) w += (1.5 * (a.n - a.c)) / a.n;
  }
  return w;
}

function pickWeighted(items, weightFn, k) {
  const pool = items.map(it => ({ it, w: Math.max(0.001, weightFn(it)) }));
  const out = [];
  while (out.length < k && pool.length) {
    let r = Math.random() * pool.reduce((s, p) => s + p.w, 0);
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= pool[i].w;
      if (r <= 0) break;
    }
    out.push(pool[i].it);
    pool.splice(i, 1);
  }
  return out;
}

export function menuSizes() {
  const D = getState().settings.daily || 50;
  return {
    review: Math.max(5, Math.round(D * 0.24)),
    lang: Math.max(8, Math.round(D * 0.3)),
    read: Math.max(4, Math.round(D * 0.2)),
    listen: Math.max(5, Math.round(D * 0.16)),
  };
}

export function dueList() {
  const s = srs();
  const today = todayStr();
  return DB.list
    .filter(q => s[q.id] && s[q.id].due <= today)
    .sort((a, b) => s[a.id].box - s[b.id].box || (s[a.id].due < s[b.id].due ? -1 : 1));
}

export function wrongList() {
  const s = srs();
  return DB.list
    .filter(q => s[q.id]?.wrongEver && !isMastered(s[q.id]))
    .sort((a, b) => (s[b.id].lastWrongD || '').localeCompare(s[a.id].lastWrongD || ''));
}

// Seen-but-not-mastered first (oldest first), then anything seen.
function staleFill(pool, s, k, exclude) {
  const ex = new Set(exclude.map(q => q.id));
  const seen = pool.filter(q => s[q.id] && !ex.has(q.id));
  seen.sort((a, b) => (isMastered(s[a.id]) - isMastered(s[b.id])) || (s[a.id].lastD < s[b.id].lastD ? -1 : 1));
  return seen.slice(0, k);
}

function singleRound(pool, k, extraWeight = () => 1) {
  const s = srs();
  const agg = aggregate(14);
  const today = todayStr();
  const w = q => typeWeight(agg, q) * tagWeight(agg, q) * (q.level === 'N2' ? 0.5 : 1) * (q.date === today ? 4 : 1) * extraWeight(q);
  let pick = pickWeighted(pool.filter(q => !s[q.id]), w, k);
  if (pick.length < k) pick = pick.concat(staleFill(pool, s, k - pick.length, pick));
  return shuffle(pick).map(q => q.id);
}

// Picks whole passages (all of their questions, in order) until ~targetQ questions.
function passageRound(pool, targetQ) {
  const s = srs();
  const agg = aggregate(14);
  const today = todayStr();
  const groups = {};
  for (const q of pool) (groups[q.passage] ||= []).push(q);
  const entries = Object.entries(groups).map(([pid, qs]) => ({ pid, qs, p: DB.passages[pid] }));
  let cands = entries.filter(e => e.qs.every(q => !s[q.id]));
  if (!cands.length) cands = entries.filter(e => e.qs.some(q => !isMastered(s[q.id])));
  if (!cands.length) cands = entries;
  const w = e => (e.p?.date === today ? 4 : 1) * typeWeight(agg, e.qs[0]);
  const picked = [];
  let n = 0;
  for (const e of pickWeighted(cands, w, cands.length)) {
    if (n >= targetQ && picked.length) break;
    picked.push(e);
    n += e.qs.length;
  }
  return picked.flatMap(e => e.qs.map(q => q.id));
}

export function buildRound(kind, arg) {
  const sizes = menuSizes();
  switch (kind) {
    case 'review':
      return dueList().slice(0, arg || sizes.review).map(q => q.id);
    case 'wrong':
      return wrongList().slice(0, arg || 20).map(q => q.id);
    case 'lang':
      return singleRound(DB.list.filter(q => LANG_ROUND.includes(q.type)), sizes.lang);
    case 'read':
      return passageRound(DB.list.filter(q => q.passage && (q.type === 'reading' || q.type === 'textgrammar')), sizes.read);
    case 'listen':
      return singleRound(DB.list.filter(q => q.type === 'listening'), sizes.listen);
    case 'type': {
      const [type, sub] = arg.split(':');
      const pool = DB.list.filter(q => q.type === type && (!sub || q.sub === sub));
      if (pool.some(q => q.passage)) return passageRound(pool, 8);
      return singleRound(pool, 10);
    }
    case 'tag': {
      const tags = Array.isArray(arg) ? arg : [arg];
      const pool = DB.list.filter(q => !q.passage && (q.tags || []).some(t => tags.includes(t)));
      const s = srs();
      const fresh = pool.filter(q => !isMastered(s[q.id]));
      return shuffle(fresh.length ? fresh : pool).slice(0, 12).map(q => q.id);
    }
    case 'n2':
      return singleRound(DB.list.filter(q => q.level === 'N2'), 10);
    default:
      return [];
  }
}

export function streak() {
  const days = new Set(getState().log.map(e => e.d));
  let d = todayStr();
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// Reading speed from logged passage times (pt is stored on the last question of a passage).
export function readingSpeed(days = 14) {
  const since = addDays(todayStr(), -(days - 1));
  const bySub = {};
  for (const e of getState().log) {
    if (!e.pt || e.d < since) continue;
    const q = DB.q[e.id];
    const p = q && DB.passages[q.passage];
    if (!p) continue;
    const key = q.sub || q.type;
    const a = (bySub[key] ||= { n: 0, ms: 0, chars: 0, target: 0 });
    a.n++;
    a.ms += e.pt;
    a.chars += p.text.length;
    a.target += (p.target || 0) * 1000;
  }
  return bySub;
}
