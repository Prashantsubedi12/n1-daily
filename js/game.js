// Game layer: XP, levels, daily quests, streak freezes, badges and sound effects.
// XP, quests and streaks are rebuilt from progress records and goal snapshots.

import { DB } from './data.js';
import { getState, getStateRevision, goalFor, todayStr, addDays } from './store.js';
import { secOf } from './engine.js';

export const XP = { ok: 10, retryOk: 5, tried: 1, combo5: 5, round: 15, perfect: 15, match: 10, quest: 20 };
const FREEZE_MAX = 2;
const SEEN_KEY = 'n1daily.seen';

// ---------- per-day stats (one pass, cached) ----------

let cache = null;
let cacheKey = '';
let cachedQuestions;

function hash(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function blankDay() {
  return { answers: 0, correct: 0, xp: 0, kanjiOk: 0, read: 0, listen: 0, combo: 0, maxCombo: 0, rounds: 0, perfect: 0, matches: 0, learned: 0, early: false, late: false };
}

function compute() {
  const st = getState();
  const key = `${getStateRevision()}:${DB.list.length}:${todayStr()}`;
  if (cache && cacheKey === key && cachedQuestions === DB.q) return cache;
  const days = {};
  const day = d => (days[d] ||= blankDay());
  let total = { answers: 0, kanjiOk: 0, read: 0, listen: 0 };

  const roundCombos = new Map();
  for (const e of [...st.log].sort((a, b) => a.t - b.t)) {
    const s = day(e.d);
    const q = DB.q[e.id];
    s.xp += e.ok ? (e.rt ? XP.retryOk : XP.ok) : XP.tried;
    if (e.roundId) {
      if (!e.rt && !e.assisted) {
        const combo = e.ok && !e.lk ? (roundCombos.get(e.roundId) || 0) + 1 : 0;
        roundCombos.set(e.roundId, combo);
        if (combo && combo % 5 === 0) s.xp += XP.combo5;
        s.maxCombo = Math.max(s.maxCombo, combo);
      }
    } else {
      // Existing records predate round IDs and used a per-day combo.
      s.combo = e.ok ? s.combo + 1 : 0;
      if (s.combo && s.combo % 5 === 0) s.xp += XP.combo5;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
    }
    if (e.rt) continue;
    s.answers++;
    total.answers++;
    if (e.ok) s.correct++;
    const h = new Date(e.t).getHours();
    if (h < 7 && h >= 4) s.early = true;
    if (h >= 23 || h < 4) s.late = true;
    if (!q) continue;
    if (q.type === 'kanji' && e.ok) (s.kanjiOk++, total.kanjiOk++);
    if (secOf(q) === 'read') (s.read++, total.read++);
    if (secOf(q) === 'listen') (s.listen++, total.listen++);
  }
  for (const e of st.events) {
    const s = day(e.d);
    if (e.k === 'end' && e.fin) {
      s.rounds++;
      s.xp += XP.round;
      if (e.a >= 5 && e.c === e.a) (s.perfect++, (s.xp += XP.perfect));
    }
    if (e.k === 'match' && e.fin) (s.matches++, (s.xp += XP.match));
  }
  for (const d of Object.values(st.learned)) day(d).learned++;

  for (const [d, s] of Object.entries(days)) {
    s.quests = questsFor(d, s);
    s.questsDone = s.quests.filter(q => q.done).length;
    s.xp += s.questsDone * XP.quest;
  }

  // Streak with freezes: a day with all 3 quests done earns a freeze (max 2); a missed day uses one.
  const studied = Object.keys(days).filter(d => days[d].answers > 0).sort();
  const today = todayStr();
  let streak = 0;
  let best = 0;
  let freezes = 0;
  const frozen = [];
  if (studied.length) {
    for (let d = studied[0]; d <= today; d = addDays(d, 1)) {
      const s = days[d];
      if (s?.answers) {
        streak++;
        if (s.questsDone === 3) freezes = Math.min(FREEZE_MAX, freezes + 1);
      } else if (d !== today) {
        if (freezes > 0 && streak > 0) {
          freezes--;
          frozen.push(d);
        } else streak = 0;
      }
      best = Math.max(best, streak);
    }
  }

  const xp = Object.values(days).reduce((n, s) => n + s.xp, 0);
  cache = { days, xp, streak, best, freezes, frozen, total };
  cacheKey = key;
  cachedQuestions = DB.q;
  return cache;
}

// ---------- daily quests ----------

const FOCUS = [
  { id: 'kanji', icon: '🈴', text: '漢字読みで5問正解', need: 5, val: s => s.kanjiOk },
  { id: 'read', icon: '📖', text: '読解を6問解く', need: 6, val: s => s.read },
  { id: 'kanji', icon: '🈴', text: '漢字読みで5問正解', need: 5, val: s => s.kanjiOk },
  { id: 'listen', icon: '🎧', text: '聴解を5問解く', need: 5, val: s => s.listen },
];
const FUN = [
  { id: 'combo', icon: '🔥', text: '5問連続で正解する', need: 5, val: s => s.maxCombo },
  { id: 'rounds', icon: '🏁', text: 'ラウンドを2回最後まで', need: 2, val: s => s.rounds },
  { id: 'match', icon: '🧩', text: '漢字マッチを1回クリア', need: 1, val: s => s.matches },
  { id: 'learn', icon: '✨', text: '新出カードを5枚「覚えた」', need: 5, val: s => s.learned },
];

// The same three quests for a date on every device: the daily goal, one weak-area quest, one fun one.
function questsFor(date, s) {
  const goal = goalFor(date);
  const h = hash(date);
  const list = [{ id: 'goal', icon: '🎯', text: `今日${goal}問解く`, need: goal, val: x => x.answers }, FOCUS[h % FOCUS.length], FUN[(h >> 3) % FUN.length]];
  return list.map(q => {
    const have = Math.min(q.need, q.val(s));
    return { id: q.id, icon: q.icon, text: q.text, need: q.need, have, done: have >= q.need };
  });
}

export function todayQuests() {
  const d = todayStr();
  return compute().days[d]?.quests || questsFor(d, blankDay());
}

// ---------- levels ----------

const TITLES = [[1, '見習い'], [5, '修行中'], [10, '中級者'], [15, '上級者'], [20, 'N1の挑戦者'], [30, 'N1マスター']];

export function levelOf(xp) {
  let level = 1;
  let need = 150;
  let left = xp;
  while (left >= need) {
    left -= need;
    level++;
    need = 150 + 50 * (level - 1);
  }
  const title = TITLES.filter(([n]) => level >= n).pop()[1];
  return { level, title, into: left, need };
}

export function progress() {
  const c = compute();
  const today = c.days[todayStr()] || blankDay();
  return { xp: c.xp, todayXp: today.xp, streak: c.streak, best: c.best, freezes: c.freezes, frozen: c.frozen, today, ...levelOf(c.xp) };
}

// ---------- badges ----------

const BADGES = [
  { id: 'first', icon: '🌱', name: '初めの一歩', desc: 'ラウンドを1回最後まで', got: c => anyDay(c, s => s.rounds > 0) },
  { id: 'streak3', icon: '🔥', name: '3日連続', desc: '3日続けて勉強', got: c => c.best >= 3 },
  { id: 'streak7', icon: '🔥', name: '1週間連続', desc: '7日続けて勉強', got: c => c.best >= 7 },
  { id: 'streak14', icon: '🌋', name: '2週間連続', desc: '14日続けて勉強', got: c => c.best >= 14 },
  { id: 'streak30', icon: '👑', name: '30日連続', desc: '30日続けて勉強', got: c => c.best >= 30 },
  { id: 'goal1', icon: '🎯', name: '目標達成', desc: '1日の目標を初めて達成', got: c => goalDays(c) >= 1 },
  { id: 'goal7', icon: '🏹', name: '目標7回', desc: '1日の目標を7日達成', got: c => goalDays(c) >= 7 },
  { id: 'q100', icon: '💯', name: '100問', desc: '合計100問', got: c => c.total.answers >= 100 },
  { id: 'q500', icon: '📚', name: '500問', desc: '合計500問', got: c => c.total.answers >= 500 },
  { id: 'q1000', icon: '🏔️', name: '1000問', desc: '合計1000問', got: c => c.total.answers >= 1000 },
  { id: 'combo10', icon: '⚡', name: '10連続', desc: '10問連続で正解', got: c => anyDay(c, s => s.maxCombo >= 10) },
  { id: 'perfect', icon: '💎', name: 'パーフェクト', desc: '5問以上のラウンドを全問正解', got: c => anyDay(c, s => s.perfect > 0) },
  { id: 'kanji50', icon: '🈴', name: '漢字ハンター', desc: '漢字読みで合計50問正解', got: c => c.total.kanjiOk >= 50 },
  { id: 'read50', icon: '📖', name: '読書家', desc: '読解を合計50問', got: c => c.total.read >= 50 },
  { id: 'listen50', icon: '🎧', name: '耳がいい', desc: '聴解を合計50問', got: c => c.total.listen >= 50 },
  { id: 'match5', icon: '🧩', name: 'マッチ名人', desc: '漢字マッチを5回クリア', got: c => sum(c, s => s.matches) >= 5 },
  { id: 'quests', icon: '🎁', name: 'クエスト制覇', desc: '1日のクエストを全部達成', got: c => anyDay(c, s => s.questsDone === 3) },
  { id: 'early', icon: '🌅', name: '朝活', desc: '朝7時前に勉強', got: c => anyDay(c, s => s.early) },
  { id: 'freeze', icon: '🧊', name: 'セーフ！', desc: 'ストリーク・フリーズで連続記録を守った', got: c => c.frozen.length > 0 },
];
const anyDay = (c, f) => Object.values(c.days).some(f);
const sum = (c, f) => Object.values(c.days).reduce((n, s) => n + f(s), 0);
const goalDays = c => Object.entries(c.days).filter(([date, s]) => s.answers >= goalFor(date)).length;

export function badges() {
  const c = compute();
  return BADGES.map(b => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, got: b.got(c) }));
}

// Badges earned since they were last shown (kept on this device only).
export function newBadges() {
  let seen = [];
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
  } catch {}
  const fresh = badges().filter(b => b.got && !seen.includes(b.id));
  if (fresh.length) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map(b => b.id)]));
    } catch {}
  }
  return fresh;
}

// ---------- sound (synthesised, no files) ----------

let ac = null;
function tone(freq, start, dur, type = 'sine', vol = 0.18) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ac.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, ac.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start);
  o.stop(ac.currentTime + start + dur + 0.05);
}

const SOUNDS = {
  ok: () => (tone(784, 0, 0.12), tone(1175, 0.09, 0.22)),
  ng: () => (tone(233, 0, 0.16, 'triangle', 0.2), tone(196, 0.12, 0.24, 'triangle', 0.2)),
  combo: () => [988, 1319, 1568].forEach((f, i) => tone(f, i * 0.07, 0.16)),
  tap: () => tone(1400, 0, 0.04, 'sine', 0.08),
  done: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, i === 3 ? 0.5 : 0.18, 'triangle', 0.2)),
  level: () => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, i * 0.08, 0.3, 'sine', 0.16)),
};

export function sound(name) {
  if (!getState().settings.sound || !SOUNDS[name]) return;
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    SOUNDS[name]();
  } catch {}
}
