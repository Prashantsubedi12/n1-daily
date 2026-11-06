// 漢字マッチ: tap a word, then its reading. Two boards of 5 pairs, built from the 漢字読み words he
// missed first, then ones he hasn't mastered, then 新出 vocab. Logged as a 'match' event (not an attempt),
// with the ids he mismatched, so the nightly analysis can see which readings still don't stick.

import { DB } from './data.js';
import { srs, isMastered, logEvent, getState } from './store.js';
import { $, $$, esc, shuffle, mmss } from './util.js';
import { mascot, sparkle, confetti } from './coach.js';
import { sound, XP } from './game.js';

const PER_BOARD = 5;
const BOARDS = 2;
const KANA = /^[ぁ-ゖー]+$/;

function pairs() {
  const s = srs();
  const missedBefore = new Set(getState().events.filter(e => e.k === 'match').flatMap(e => e.ids || []));
  const kanji = DB.list
    .filter(q => q.type === 'kanji' && /__(.+?)__/.test(q.q || ''))
    .map(q => ({ id: q.id, w: q.q.match(/__(.+?)__/)[1], r: q.choices[q.answer], rank: s[q.id]?.wrongEver || missedBefore.has(q.id) ? 0 : isMastered(s[q.id]) ? 3 : s[q.id] ? 1 : 2 }));
  const vocab = DB.learn
    .filter(c => c.kind === 'vocab' && c.w && KANA.test(c.r || '') && /[一-龯]/.test(c.w))
    .map(c => ({ id: c.id, w: c.w, r: c.r, rank: missedBefore.has(c.id) ? 0 : 2 }));
  const seen = new Set();
  const out = [];
  for (const p of shuffle([...kanji, ...vocab]).sort((a, b) => a.rank - b.rank)) {
    // A board can't contain two identical words or readings, or the pairing becomes ambiguous.
    if (seen.has(p.w) || seen.has(p.r)) continue;
    seen.add(p.w);
    seen.add(p.r);
    out.push(p);
    if (out.length === PER_BOARD * BOARDS) break;
  }
  return out;
}

let M = null;

export function viewMatch(view) {
  leaveMatch();
  const all = pairs();
  if (all.length < PER_BOARD) {
    view.innerHTML = '<p class="muted center">マッチに使える単語がまだありません。</p>';
    return;
  }
  M = { all, board: 0, miss: 0, missed: new Set(), start: Date.now(), pick: null, left: 0, timer: null, transition: null };
  renderBoard(view);
}

export function leaveMatch() {
  if (M) {
    clearInterval(M.timer);
    clearTimeout(M.transition);
  }
  M = null;
}

function renderBoard(view) {
  const set = M.all.slice(M.board * PER_BOARD, (M.board + 1) * PER_BOARD);
  const boards = Math.ceil(M.all.length / PER_BOARD);
  M.left = set.length;
  const tile = (p, side) => `<button class="mtile ${side}" data-k="${esc(p.id)}" data-side="${side}">${esc(side === 'w' ? p.w : p.r)}</button>`;
  view.innerHTML = `
  <div class="match">
    <div class="quiz-top">
      <button class="icon-btn" data-act="exit" aria-label="やめる">✕</button>
      <div class="qprog" aria-hidden="true"><i style="width:${(M.board / boards) * 100}%"></i></div>
      <span class="qcount" id="mtime">0:00</span>
    </div>
    <div class="match-head">${mascot('calm')}<div class="bubble">漢字と読みをペアにしよう！ ${M.board + 1} / ${boards}</div></div>
    <div class="mgrid">
      <div class="mcol">${shuffle(set).map(p => tile(p, 'w')).join('')}</div>
      <div class="mcol">${shuffle(set).map(p => tile(p, 'r')).join('')}</div>
    </div>
  </div>`;
  $('[data-act="exit"]', view).addEventListener('click', () => {
    leaveMatch();
    location.hash = '#/learn';
  });
  $$('.mtile', view).forEach(b => b.addEventListener('click', () => tap(b, view)));
  clearInterval(M.timer);
  const tick = () => {
    const el = $('#mtime');
    if (el && M) el.textContent = mmss(Date.now() - M.start);
  };
  tick();
  M.timer = setInterval(tick, 1000);
}

function tap(b, view) {
  if (!M || b.disabled) return;
  if (!M.pick) {
    M.pick = b;
    b.classList.add('picked');
    sound('tap');
    return;
  }
  if (M.pick === b) {
    b.classList.remove('picked');
    M.pick = null;
    return;
  }
  const a = M.pick;
  if (a.dataset.side === b.dataset.side) {
    a.classList.remove('picked');
    b.classList.add('picked');
    M.pick = b;
    sound('tap');
    return;
  }
  M.pick = null;
  a.classList.remove('picked');
  if (a.dataset.k === b.dataset.k) {
    [a, b].forEach(x => {
      x.disabled = true;
      x.classList.add('matched');
    });
    sparkle(b);
    sound('ok');
    if (--M.left === 0) {
      const session = M;
      M.transition = setTimeout(() => {
        if (M === session) nextBoard(view);
      }, 450);
    }
  } else {
    M.miss++;
    M.missed.add(a.dataset.side === 'w' ? a.dataset.k : b.dataset.k);
    [a, b].forEach(x => {
      x.classList.remove('nope');
      void x.offsetWidth;
      x.classList.add('nope');
    });
    sound('ng');
  }
}

function nextBoard(view) {
  M.board++;
  if (M.board * PER_BOARD < M.all.length) return renderBoard(view);
  clearInterval(M.timer);
  const ms = Date.now() - M.start;
  logEvent('match', { fin: 1, n: M.all.length, miss: M.miss, ms, ids: [...M.missed] });
  const great = M.miss <= 1;
  view.innerHTML = `
  <div class="summary match-done">
    <div class="sum-hero">${mascot(great ? 'wow' : 'happy', 'lg')}<div class="bubble">${great ? 'ほぼノーミス！漢字の読み、身についてきたね🎉' : 'クリア！間違えたペアは次のマッチで先に出すね'}</div></div>
    <div class="sum-stats">
      <span>⚡ +${XP.match} XP</span>
      <span>⏱ ${mmss(ms)}</span>
      <span>❌ ミス ${M.miss}</span>
    </div>
    ${
      M.missed.size
        ? `<h3>間違えたペア</h3><ul class="wrong-list">${M.all
            .filter(p => M.missed.has(p.id))
            .map(p => `<li><div class="wl-q">${esc(p.w)}</div><div class="wl-a">${esc(p.r)}</div></li>`)
            .join('')}</ul>`
        : ''
    }
    <div class="sum-actions">
      <button class="btn primary" data-act="again">もう一回</button>
      <button class="btn" data-act="home">ホームへ</button>
    </div>
  </div>`;
  sound('done');
  confetti();
  $('[data-act="again"]', view).addEventListener('click', () => viewMatch(view));
  $('[data-act="home"]', view).addEventListener('click', () => {
    leaveMatch();
    location.hash = '#/';
  });
  M = null;
}
