// The question screen: one question at a time, instant feedback, missed 語彙/文法 items come back once at the end.

import { DB } from './data.js';
import { getState, save, recordAttempt, setLucky, addFeedback, todayStr } from './store.js';
import { typeLabel } from './engine.js';
import { $, $$, esc, fmt, paras, mmss, shuffle, plain, toast } from './util.js';
import * as tts from './speech.js';
import { mascot, reaction, summaryLine, ring, sparkle, confetti } from './coach.js';
import { progress, todayQuests, newBadges, sound } from './game.js';

const RETRY_TYPES = new Set(['kanji', 'context', 'paraphrase', 'usage', 'grammar', 'order']);
// One tap from the explanation; the nightly generator fixes reported questions.
const REPORT_REASONS = ['正解が2つある', '正解がおかしい', '日本語が不自然', '解説がわかりにくい'];
// A correct 語彙/文法 answer slower than this gets a "speed up" nudge instead of praise.
const SLOW_MS = 35000;

let S = null;
let bindResume = () => ({});
let listeningForPause = false;

function saveDraft() {
  const { timer, clockStartedAt, onDone, onProgress, ...draft } = S;
  getState().activeQuiz = structuredClone(draft);
  return save();
}

function validDraft() {
  const draft = getState()?.activeQuiz;
  if (draft?.version !== 1 || typeof draft.id !== 'string') return null;
  if (!Array.isArray(draft.items) || !draft.items.length || !draft.items.every(item => typeof item?.id === 'string')) return null;
  if (!Number.isInteger(draft.pos) || draft.pos < 0 || draft.pos > draft.items.length) return null;
  if (!Array.isArray(draft.results) || !Array.isArray(draft.order) || !Array.isArray(draft.slots) || !draft.context || !draft.before || !draft.passageTimes) return null;
  return draft;
}

export function savedQuizQuestionIds() {
  return [...new Set(validDraft()?.items.map(item => item.id) || [])];
}

export function activeQuiz() {
  const draft = validDraft();
  return draft && !draft.done ? { ...draft.context, title: draft.title, pos: draft.pos, total: draft.items.length } : null;
}

export function restoreQuiz(bind) {
  bindResume = bind || bindResume;
  const draft = validDraft();
  if (draft && !S) {
    const restored = structuredClone(draft);
    S = { ...restored, ...bindResume(restored.context), timer: null, clockStartedAt: null };
    if (S.audioStatus === 'starting' || S.audioStatus === 'playing') S.audioStatus = 'interrupted';
  }
  if (listeningForPause) return;
  listeningForPause = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseQuiz();
    else startClock();
  });
  window.addEventListener('pagehide', pauseQuiz);
  window.addEventListener('pageshow', startClock);
}

export function resumeQuiz() {
  if (!activeQuiz()) return false;
  restoreQuiz(bindResume);
  showQuizRoute();
  return true;
}

function showQuizRoute() {
  if (location.hash === '#/quiz') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/quiz';
}

export function startQuiz({ ids, start = 0, title = '', retry = false, context = {}, onProgress, onDone }) {
  if (S) leaveQuiz();
  const before = progress();
  S = {
    version: 1,
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    retryRound: retry,
    items: ids.map(id => ({ id, rt: retry })),
    base: ids.length,
    pos: start,
    title,
    context: { ...context, title },
    onProgress,
    onDone,
    results: [],
    order: [],
    answer: null,
    elapsed: 0,
    activeMs: 0,
    passageTimes: {},
    clockStartedAt: null,
    audioStatus: 'idle',
    transcript: false,
    plays: 0,
    timer: null,
    done: false,
    combo: 0,
    maxCombo: 0,
    wrongRun: 0,
    before: { xp: before.xp, level: before.level, quests: todayQuests().map(q => q.done) },
    slots: [],
  };
  saveDraft();
  showQuizRoute();
}

export function hasSession() {
  return !!S;
}

// How the round went, for the nightly analysis (fin = reached the result screen).
function roundInfo() {
  return { fin: 1, roundId: S.id, a: S.results.length, c: S.results.filter(r => r.ok && !r.lucky).length, of: S.base };
}

export function leaveQuiz() {
  if (!S) return;
  clearInterval(S.timer);
  pauseQuiz();
  if (S.done) {
    getState().activeQuiz = null;
    save();
  }
  S = null;
}

function startClock() {
  if (!S || S.answer || S.done || document.hidden || location.hash !== '#/quiz' || S.clockStartedAt != null) return;
  const q = DB.q[S.items[S.pos]?.id];
  if (q && (!q.passage || DB.passages[q.passage])) S.clockStartedAt = performance.now();
}

function elapsedNow() {
  return S.clockStartedAt == null ? 0 : performance.now() - S.clockStartedAt;
}

function stopClock() {
  const elapsed = elapsedNow();
  S.clockStartedAt = null;
  S.elapsed += elapsed;
  S.activeMs += elapsed;
  const q = DB.q[S.items[S.pos]?.id];
  if (q?.passage) S.passageTimes[q.passage] = (S.passageTimes[q.passage] || 0) + elapsed;
}

function pauseQuiz() {
  if (!S || S.done) return;
  stopClock();
  tts.stop();
  if (S.audioStatus === 'starting' || S.audioStatus === 'playing') {
    S.audioStatus = 'interrupted';
    updateAudio($('#view'));
  }
  saveDraft();
}

function showEn() {
  return getState().settings.showEn;
}

export function renderQuiz(root) {
  if (!S) {
    restoreQuiz(bindResume);
    if (!S) {
      location.hash = '#/';
      return;
    }
  }
  clearInterval(S.timer);
  if (S.pos >= S.items.length) return renderSummary(root);

  const item = S.items[S.pos];
  const q = DB.q[item.id];
  const p = q?.passage ? DB.passages[q.passage] : null;
  if (!q || (q.passage && !p)) {
    root.innerHTML = '<div class="card"><p>この問題はまだ読み込めません。接続を確認して再読み込みしてください。</p><button class="btn" data-act="exit">ホームへ</button></div>';
    $('[data-act="exit"]', root).addEventListener('click', exitQuiz);
    return;
  }
  const n = S.items.length;
  const firstOfPassage = !!p && !S.passageTimes[p.id];
  const hiddenChoices = q.type === 'listening' && !q.printed && !S.transcript;
  const longChoices = q.type === 'usage' || q.choices.some(c => c.length > 14);
  const order = q.type === 'order' && (q.q.match(/＿★＿|＿＿/g) || []).length === q.choices.length;
  if (!S.order.length) {
    S.order = q.fixed ? q.choices.map((_, i) => i) : shuffle(q.choices.map((_, i) => i));
    S.slots = order ? q.choices.map(() => null) : [];
    saveDraft();
  }
  startClock();

  root.innerHTML = `
  <div class="quiz${getState().settings.mincho ? ' mincho' : ''}">
    <div class="quiz-top">
      <button class="icon-btn" data-act="exit" aria-label="中断してホームへ">✕</button>
      <div class="qprog" role="progressbar" aria-label="問題の進み具合" aria-valuemin="0" aria-valuenow="${S.pos}" aria-valuemax="${n}"><i style="width:${(S.pos / n) * 100}%"></i></div>
      ${p ? '<span class="ptimer" id="ptimer"></span>' : ''}
      <span class="combo" id="combo"${S.combo >= 2 ? '' : ' hidden'}>🔥${S.combo}</span>
      <span class="qcount">${S.pos + 1} / ${n}</span>
    </div>
    <div class="qmeta">
      <span class="qtype" tabindex="-1">${esc(typeLabel(q))}</span>
      ${q.level === 'N2' ? '<span class="tag">N2</span>' : ''}
      ${item.rt ? '<span class="tag rt">もう一度</span>' : ''}
    </div>
    ${p ? passageHTML(p) : ''}
    ${q.type === 'listening' ? listenHTML(q) : ''}
    ${q.q ? `<div class="qtext" id="qtext" tabindex="-1">${order ? orderText(q.q) : fmt(q.q)}</div>` : ''}
    ${order ? '<p class="small muted order-hint">タップして並べよう。置いた語句をもう一度タップすると取り消せます。★に入るものが答えです。</p>' : ''}
    <div class="choices${order ? ' tiles' : longChoices ? ' long' : ''}${hiddenChoices ? ' audio' : ''}">
      ${S.order
        .map((orig, i) =>
          order
            ? `<button class="tile" data-i="${orig}">${fmt(q.choices[orig])}</button>`
            : `<button class="choice" data-i="${orig}"><span class="num">${i + 1}</span><span class="ct">${hiddenChoices ? '' : fmt(q.choices[orig])}</span></button>`,
        )
        .join('')}
    </div>
    ${order ? '<button class="btn primary wide" data-act="submit-order" disabled>並べ方を確定</button>' : ''}
    <div id="feedback"></div>
    <div class="quiz-actions" id="actions" hidden>
      <button class="btn primary wide" data-act="next">${S.pos + 1 < n ? '次へ' : '結果を見る'}</button>
    </div>
  </div>`;

  $$('.choice', root).forEach(b => b.addEventListener('click', () => answer(Number(b.dataset.i), root)));
  if (order) {
    $$('.tile', root).forEach(b => b.addEventListener('click', () => changeSlot(S.slots.indexOf(null), Number(b.dataset.i), q, root)));
    $$('.slot', root).forEach(b => b.addEventListener('click', () => changeSlot(Number(b.dataset.s), null, q, root)));
    $('[data-act="submit-order"]', root).addEventListener('click', () => {
      if (!S.slots.includes(null)) answer(S.slots[starSlot(q.q)], root);
    });
    updateSlots(q, root);
  }
  $('[data-act="exit"]', root).addEventListener('click', exitQuiz);
  $('[data-act="next"]', root).addEventListener('click', next);
  const play = $('[data-act="play"]', root);
  if (play) play.addEventListener('click', () => playAudio(q, root));
  const transcript = $('[data-act="transcript"]', root);
  if (transcript) transcript.addEventListener('click', () => {
    S.transcript = true;
    saveDraft();
    renderQuiz(root);
    $('.listen .script summary', root)?.focus();
  });
  if (q.type === 'listening') updateAudio(root);

  if (p) {
    const tick = () => {
      const el = $('#ptimer', root);
      if (!el) return;
      const ms = (S.passageTimes[p.id] || 0) + elapsedNow();
      el.textContent = `⏱ ${mmss(ms)} / ${mmss((p.target || 0) * 1000)}`;
      el.classList.toggle('over', p.target && ms > p.target * 1000);
    };
    tick();
    S.timer = setInterval(tick, 1000);
  }

  if (p && !firstOfPassage) $('#qtext')?.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
  if (S.answer) renderFeedback(q, root);
}

// 文の組み立て: the blanks become tap targets; pieces fill them left to right.
function orderText(text) {
  let k = 0;
  return text
    .split(/(＿★＿|＿＿)/)
    .map(part => (part === '＿★＿' || part === '＿＿' ? `<button class="slot${part === '＿★＿' ? ' star' : ''}" data-s="${k++}"></button>` : fmt(part)))
    .join('');
}

function starSlot(text) {
  return (text.match(/＿★＿|＿＿/g) || []).indexOf('＿★＿');
}

function changeSlot(k, choice, q, root) {
  if (S.answer || k < 0) return;
  const removed = S.slots[k];
  S.slots[k] = choice;
  saveDraft();
  updateSlots(q, root);
  sound('tap');
  const nextControl = choice == null ? $(`.tile[data-i="${removed}"]`, root)
    : $('.tile:not(:disabled)', root) || $('[data-act="submit-order"]', root);
  nextControl?.focus({ preventScroll: true });
}

function updateSlots(q, root) {
  $$('.tile', root).forEach(tile => {
    const used = S.slots.includes(Number(tile.dataset.i));
    tile.disabled = used || !!S.answer;
    tile.classList.toggle('used', used);
  });
  $$('.slot', root).forEach((slot, k) => {
    const choice = S.slots[k];
    slot.innerHTML = choice == null ? '' : fmt(q.choices[choice]);
    slot.disabled = choice == null || !!S.answer;
    slot.classList.toggle('filled', choice != null);
    const label = `${k + 1}番目${slot.classList.contains('star') ? '、星' : ''}`;
    slot.setAttribute('aria-label', choice == null ? `${label}、空欄` : `${label}、${plain(q.choices[choice])}、タップで取り消し`);
  });
  const submit = $('[data-act="submit-order"]', root);
  submit.disabled = S.slots.includes(null) || !!S.answer;
  submit.hidden = !!S.answer;
}

// "+10 XP" rising from where he tapped.
function floatXp(el, n) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const t = document.createElement('span');
  t.className = 'xp-pop';
  t.textContent = `+${n} XP`;
  t.style.left = `${r.left + r.width / 2}px`;
  t.style.top = `${r.top}px`;
  document.body.append(t);
  setTimeout(() => t.remove(), 1000);
}

function passageHTML(p) {
  const kindLabel = p.kind === 'info' ? '資料' : p.kind === 'textgrammar' ? '文章' : '本文';
  const body = p.kind === 'info' ? `<div class="ptext pre">${fmt(p.text)}</div>` : `<div class="ptext">${paras(p.text)}</div>`;
  return `<details class="passage" open>
    <summary>${kindLabel}${p.title ? '：' + esc(p.title) : ''}<span class="plen">${p.text.length}字</span></summary>
    ${body}
  </details>`;
}

function listenHTML(q) {
  const exam = getState().settings.examMode;
  if (S.transcript) {
    return `<div class="listen fallback"><p class="note">スクリプト練習。聴解の実力目安には含まれません。</p>${scriptHTML(q, true)}</div>`;
  }
  return `<div class="listen">
    ${tts.supported ? '<button class="play" data-act="play" aria-label="音声を再生"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></button>' : ''}
    <div>
      <div class="ltitle">${q.sub === 'response' ? '短い発話を聞いて、最もよい返事を選んでください' : '音声を聞いて答えてください'}</div>
      <div class="lnote" id="lnote" role="status">${exam ? '本番モード：再生は1回だけ' : '何度でも再生できます'}</div>
      <button class="linkish" data-act="transcript" hidden>スクリプトで練習する</button>
    </div>
  </div>
  ${q.printed && q.ask ? `<div class="qtext ask">${fmt(q.ask)}</div>` : ''}`;
}

function scriptHTML(q, open = false) {
  const who = { M: '男', F: '女', N: '' };
  const lines = [
    q.intro ? `<p class="narr">${fmt(q.intro)}</p>` : '',
    ...q.script.map(l => `<p><b>${who[l.s] || ''}${who[l.s] ? '：' : ''}</b>${fmt(l.t)}</p>`),
    q.ask ? `<p class="narr">${fmt(q.ask)}</p>` : '',
  ].join('');
  return `<details class="script"${open ? ' open' : ''}><summary>スクリプト</summary>${lines}</details>`;
}

function playAudio(q, root) {
  const session = S;
  const pos = S.pos;
  const answered = !!S.answer;
  const current = () => S === session && S.pos === pos && !!S.answer === answered;
  const setStatus = status => {
    if (!current()) return;
    S.audioStatus = status;
    updateAudio(root);
    saveDraft();
  };
  setStatus('starting');
  const queued = tts.speak(tts.partsFor(q, S.order), {
    onStart() {
      if (!current()) return;
      if (!answered) S.plays++;
      setStatus('playing');
    },
    onEnd: () => setStatus('complete'),
    onError: () => setStatus('failed'),
  });
  if (!queued) setStatus('failed');
}

function updateAudio(root) {
  if (!root || !S) return;
  const note = $('#lnote', root);
  if (!note) return;
  const exam = getState().settings.examMode;
  const state = tts.supported ? S.audioStatus : 'failed';
  const busy = state === 'starting' || state === 'playing';
  const used = exam && !S.answer && state === 'complete';
  const texts = {
    idle: exam ? '本番モード：再生は1回だけ' : '何度でも再生できます',
    starting: '音声を準備中…',
    playing: '再生中…',
    complete: used ? '再生終了（本番モード）' : 'もう一度聞くには ▶',
    interrupted: '再生が中断されました。もう一度再生できます。',
    failed: '日本語の音声を再生できませんでした。再試行するか、スクリプト練習を選べます。',
  };
  note.textContent = texts[state];
  const play = $('[data-act="play"]', root);
  if (play) {
    play.classList.toggle('playing', busy);
    play.disabled = busy || used;
  }
  $('[data-act="transcript"]', root).hidden = !!S.answer || !['failed', 'interrupted'].includes(state);
}

function answer(chosen, root) {
  const item = S.items[S.pos];
  const q = DB.q[item.id];
  if (S.answer || !Number.isInteger(chosen) || chosen < 0 || chosen >= q.choices.length) return;
  stopClock();
  tts.stop();
  const assisted = q.type === 'listening' && (S.transcript || S.plays !== 1 || S.audioStatus !== 'complete');
  S.audioStatus = 'idle';
  const ok = chosen === q.answer;
  let pt;
  if (q.passage) {
    const nextItem = S.items[S.pos + 1];
    const endsPassage = !nextItem || DB.q[nextItem.id]?.passage !== q.passage;
    if (endsPassage && !item.rt) {
      pt = S.passageTimes[q.passage];
      clearInterval(S.timer);
    }
  }
  const ms = S.elapsed;
  const same = !ok && getState().log.some(x => x.id === q.id && !x.ok && x.ch === chosen);
  const xpBefore = progress().xp;
  const e = recordAttempt({ id: q.id, ok, ch: chosen, ms, rt: item.rt, pt, pl: S.plays, roundId: S.id, attemptId: `${S.id}:${S.pos}`, assisted }, { persist: false });
  if (!item.rt || S.retryRound) S.results.push({ id: q.id, ok, rid: e.rid, t: e.t, ch: chosen, assisted });
  if (!ok && !item.rt && RETRY_TYPES.has(q.type)) S.items.push({ id: q.id, rt: true });
  const lostCombo = ok || item.rt || assisted ? 0 : S.combo;
  refreshCombo();
  S.wrongRun = ok ? 0 : S.wrongRun + 1;
  S.answer = {
    chosen, ok, rid: e.rid, t: e.t, assisted,
    say: reaction({
      ok,
      rt: item.rt,
      combo: S.combo,
      lostCombo,
      wrongRun: S.wrongRun,
      slow: ok && !item.rt && RETRY_TYPES.has(q.type) && ms > SLOW_MS,
      same,
      retrySoon: !ok && !item.rt && RETRY_TYPES.has(q.type),
    }),
  };
  S.onProgress?.(Math.min(S.pos + 1, S.base));
  saveDraft();
  renderFeedback(q, root, true, Math.max(0, progress().xp - xpBefore));
}

function refreshCombo() {
  S.combo = 0;
  S.maxCombo = 0;
  if (S.retryRound) return;
  for (const r of S.results) {
    if (r.assisted) continue;
    S.combo = r.ok && !r.lucky ? S.combo + 1 : 0;
    S.maxCombo = Math.max(S.maxCombo, S.combo);
  }
}

function renderFeedback(q, root, fresh = false, gain = 0) {
  const item = S.items[S.pos];
  const { chosen, ok, say, assisted, rid, t, reported } = S.answer;
  const luckyMarked = S.results.find(r => (r.rid || r.t) === (rid || t))?.lucky;
  const combo = $('#combo', root);
  combo.hidden = S.combo < 2;
  combo.textContent = `🔥${S.combo}`;
  if (fresh) {
    sound(!ok ? 'ng' : !item.rt && !assisted && S.combo > 0 && S.combo % 5 === 0 ? 'combo' : 'ok');
    combo.classList.add('pop');
  }

  $$('.choice', root).forEach(b => {
    const i = Number(b.dataset.i);
    b.disabled = true;
    if (i === q.answer) b.classList.add('correct');
    if (i === chosen && !ok) b.classList.add('wrong');
    if (fresh && i === chosen && ok) sparkle(b);
    if (fresh && i === chosen && gain) floatXp(b, gain);
    const ct = $('.ct', b);
    if (!ct.textContent) ct.innerHTML = fmt(q.choices[i]);
  });
  const orderNote = S.slots.length ? markOrder(q, ok, root, fresh ? gain : 0) : '';
  $('.choices', root).classList.remove('audio');
  const pos = S.order.indexOf(q.answer) + 1;
  $('#feedback', root).innerHTML = `
    <div class="fb ${ok ? 'fb-ok' : 'fb-ng'}" tabindex="-1">
      <div class="fb-head">
        <span class="fb-who">${mascot(say.mood)}<span class="fb-say"><b>${ok ? '○ 正解' : S.slots.length ? `× 不正解 — ★は「${esc(plain(q.choices[q.answer]))}」` : `× 不正解 — 正解は ${pos}`}</b><span>${esc(say.text)}</span></span></span>
        ${ok && !item.rt ? `<button class="chip" data-act="lucky" aria-pressed="${!!luckyMarked}">${luckyMarked ? 'まぐれ ✓ 復習に回します' : 'まぐれだった'}</button>` : ''}
      </div>
      ${orderNote}
      ${q.type === 'reading' ? readingEvidence(q, chosen) : ''}
      ${q.exp ? `<div class="exp">${fmt(q.exp)}</div>` : ''}
      ${q.en && showEn() ? `<div class="en">${esc(q.en)}</div>` : ''}
      ${q.type === 'listening' && !S.transcript ? scriptHTML(q) : ''}
      <div class="report-q" id="reportQ">${reported ? '<span class="small muted">この端末に記録しました。</span>' : '<button class="linkish" data-act="report">⚑ この問題を報告</button>'}</div>
    </div>`;
  $('[data-act="report"]', root)?.addEventListener('click', () => {
    const box = $('#reportQ', root);
    box.innerHTML = REPORT_REASONS.map(r => `<button class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('');
    $$('[data-reason]', box).forEach(b =>
      b.addEventListener('click', () => {
        addFeedback(b.dataset.reason, q.id);
        S.answer.reported = true;
        saveDraft();
        box.innerHTML = '<span class="small muted">この端末に記録しました。</span>';
        toast('この端末に記録しました');
      }),
    );
  });
  const lucky = $('[data-act="lucky"]', root);
  if (lucky) {
    lucky.addEventListener('click', () => {
      const on = lucky.getAttribute('aria-pressed') !== 'true';
      lucky.setAttribute('aria-pressed', String(on));
      lucky.textContent = on ? 'まぐれ ✓ 復習に回します' : 'まぐれだった';
      setLucky(rid || t, on, { persist: false });
      const r = S.results.find(x => (x.rid || x.t) === (rid || t));
      if (r) r.lucky = on;
      refreshCombo();
      combo.hidden = S.combo < 2;
      combo.textContent = `🔥${S.combo}`;
      saveDraft();
    });
  }
  if (q.type === 'listening') updateAudio(root);
  $('#actions', root).hidden = false;
  $('#actions', root).classList.add(ok ? 'ok' : 'ng');
  if (fresh) {
    $('.fb', root).focus({ preventScroll: true });
    $('#feedback', root).scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  } else {
    $('#feedback', root).scrollIntoView({ block: 'nearest' });
  }
}

function readingEvidence(q, chosen) {
  const p = DB.passages[q.passage];
  const { quote, distractors } = q.evidence || {};
  if (!quote || !p?.text.includes(quote)) return '';
  const index = chosen === q.answer ? Number(Object.keys(distractors || {})[0]) : chosen;
  const detail = index !== q.answer && distractors?.[index];
  return `<details class="reading-evidence"><summary>本文の根拠を見る</summary>
    <blockquote>${fmt(quote)}</blockquote>
    ${detail ? `<p class="reading-distractor"><b>選択肢「${esc(plain(q.choices[index]))}」の落とし穴</b>　${fmt(detail)}</p>` : ''}
  </details>`;
}

function markOrder(q, ok, root, gain) {
  updateSlots(q, root);
  const star = $('.slot.star', root);
  star.classList.add(ok ? 'correct' : 'wrong');
  if (gain) floatXp(star, gain);
  const right = Array.isArray(q.order)
    ? q.order.map(i => plain(q.choices[i]))
    : (q.exp || '').match(/正しい順[:：]\s*([^。]+)/)?.[1].split('／').map(x => x.trim());
  const mine = S.slots.map(i => plain(q.choices[i]));
  if (!right || right.length !== mine.length) return '';
  const same = right.every((x, i) => x === mine[i]);
  return `<div class="order-line small"><div>あなた：${esc(mine.join('／'))}</div>${same ? '<div class="ok">並べ方も完璧！</div>' : `<div>正しい順：${esc(right.join('／'))}</div>`}</div>`;
}

function next() {
  if (!S?.answer) return;
  tts.stop();
  S.pos++;
  S.answer = null;
  S.order = [];
  S.slots = [];
  S.elapsed = 0;
  S.plays = 0;
  S.audioStatus = 'idle';
  S.transcript = false;
  saveDraft();
  renderQuiz($('#view'));
  ($('#qtext') || $('.qtype'))?.focus({ preventScroll: true });
}

function exitQuiz() {
  leaveQuiz();
  location.hash = '#/';
}

function renderSummary(root) {
  clearInterval(S.timer);
  const first = !S.done;
  if (first) {
    S.done = true;
    if (!S.retryRound) S.onDone?.(roundInfo());
    saveDraft();
  }
  const res = S.results;
  const good = res.filter(r => r.ok && !r.lucky).length;
  const wrong = res.filter(r => !r.ok || r.lucky);
  const rate = res.length ? Math.round((good / res.length) * 100) : 0;
  const say = summaryLine(rate);
  const st = getState();
  const goal = st.settings.daily;
  const todayN = st.log.filter(e => e.d === todayStr() && !e.rt).length;
  const goalJustMet = !S.retryRound && todayN >= goal && todayN - res.length < goal;
  const mins = Math.max(1, Math.round(S.activeMs / 60000));
  const now = progress();
  const gained = Math.max(0, now.xp - S.before.xp);
  const levelUp = now.level > S.before.level;
  const quests = todayQuests();
  const fresh = first ? newBadges() : [];
  root.innerHTML = `
  <div class="summary" tabindex="-1" aria-label="練習の結果">
    <div class="sum-hero">
      ${mascot(say.mood, 'lg')}
      <div class="bubble">${esc(goalJustMet ? `今日の目標${goal}問を達成🎉 ${say.text}` : say.text)}</div>
    </div>
    <div class="sum-score ${rate >= 70 ? 'good' : rate >= 50 ? 'mid' : 'low'}">
      <div class="big">${good}<small> / ${res.length}</small></div>
      <div>${S.title ? esc(S.title) + '　' : ''}正答率 ${rate}%</div>
    </div>
    <div class="xp-gain"><b id="xpCount">+0</b> XP</div>
    ${levelUp ? `<div class="levelup">⬆️ レベルアップ！ <b>Lv.${now.level}</b> ${esc(now.title)}</div>` : ''}
    <div class="lvl-row"><span class="lvl">Lv.${now.level}</span><div class="bar-track"><i style="width:${Math.round((now.into / now.need) * 100)}%"></i></div><span class="small muted">${now.into}/${now.need}</span></div>
    <div class="sum-stats">
      <span>🔥 最大${S.maxCombo}連続</span>
      <span>⏱ ${mins}分</span>
      <span class="sum-goal">${ring(todayN, goal)}今日 ${todayN}/${goal}問</span>
    </div>
    ${fresh.map(b => `<div class="badge-new"><span class="bicon">${b.icon}</span><span><b>新しいバッジ：${esc(b.name)}</b><span class="small muted">${esc(b.desc)}</span></span></div>`).join('')}
    <section class="card quests">
      <div class="card-label">🎁 今日のクエスト</div>
      ${questList(quests, S.before.quests)}
    </section>
    ${
      wrong.length
        ? `<h3>見直し（${wrong.length}）</h3>
           <ul class="wrong-list">${wrong
             .map(r => {
               const q = DB.q[r.id];
               if (!q) return '';
               return `<li><div class="wl-type">${esc(typeLabel(q))}${r.lucky ? ' ・まぐれ' : ''}</div>
                 <div class="wl-q">${esc(plain(q.q || q.ask || DB.passages[q.passage]?.title || '')).slice(0, 80)}</div>
                 <div class="wl-a">正解：${fmt(q.choices[q.answer])}</div></li>`;
             })
             .join('')}</ul>`
        : '<p class="center muted">全問正解。見直しはなし！</p>'
    }
    <div class="sum-actions">
      ${wrong.length ? '<button class="btn" data-act="redo">間違えた問題を解き直す</button>' : ''}
      ${S.context.kind === 'priority' ? '<a class="btn" href="#/review">復習を見る</a>' : ''}
      <button class="btn primary" data-act="home">ホームへ</button>
    </div>
  </div>`;
  $('[data-act="home"]', root).addEventListener('click', () => {
    leaveQuiz();
    location.hash = '#/';
  });
  const redo = $('[data-act="redo"]', root);
  if (redo) redo.addEventListener('click', () => startQuiz({ ids: wrong.map(r => r.id), title: '解き直し', retry: true, context: { kind: 'redo' } }));
  $('.summary', root).focus({ preventScroll: true });
  window.scrollTo(0, 0);
  const newQuest = quests.some((q, i) => q.done && !S.before.quests[i]);
  if (first && (goalJustMet || levelUp || newQuest || fresh.length || (rate >= 70 && res.length >= 3))) confetti();
  if (first) sound(levelUp ? 'level' : 'done');
  if (first && !matchMedia('(prefers-reduced-motion: reduce)').matches) countUp($('#xpCount', root), gained);
  else $('#xpCount', root).textContent = `+${gained}`;
}

export function questList(quests, before = []) {
  return `<ul class="quest-list">${quests
    .map(
      (q, i) => `<li class="${q.done ? 'done' : ''}${q.done && !before[i] ? ' just' : ''}">
        <span class="qicon">${q.done ? '✅' : q.icon}</span>
        <span class="qbody"><span>${esc(q.text)}</span><span class="bar-track"><i style="width:${Math.round((q.have / q.need) * 100)}%"></i></span></span>
        <span class="small muted">${q.done && !before[i] ? '達成！' : `${q.have}/${q.need}`}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function countUp(el, n) {
  if (!el) return;
  const t0 = performance.now();
  const step = t => {
    const p = Math.min(1, (t - t0) / 900);
    el.textContent = `+${Math.round(n * (1 - Math.pow(1 - p, 3)))}`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function quizKey(ev) {
  if (!S || location.hash !== '#/quiz') return;
  if (ev.defaultPrevented || ev.repeat || ev.ctrlKey || ev.altKey || ev.metaKey || ev.target.closest?.('input, textarea, select, button, a, summary, [contenteditable]')) return;
  const n = Number(ev.key);
  if (n >= 1 && n <= 4 && !S.answer) {
    const btn = $$('.choice, .tile')[n - 1];
    if (btn) btn.click();
  } else if ((ev.key === 'Enter' || ev.key === ' ') && S.answer) {
    ev.preventDefault();
    next();
  } else if (ev.key === 'p') {
    $('[data-act="play"]')?.click();
  }
}
