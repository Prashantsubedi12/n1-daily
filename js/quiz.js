// The question screen: one question at a time, instant feedback, missed 語彙/文法 items come back once at the end.

import { DB } from './data.js';
import { getState, recordAttempt, setLucky } from './store.js';
import { typeLabel } from './engine.js';
import { $, $$, esc, fmt, paras, mmss, shuffle, plain } from './util.js';
import * as tts from './speech.js';

const RETRY_TYPES = new Set(['kanji', 'context', 'paraphrase', 'usage', 'grammar', 'order']);

let S = null;

export function startQuiz({ ids, start = 0, title = '', retry = false, onProgress, onDone }) {
  S = {
    items: ids.map(id => ({ id, rt: retry })),
    base: ids.length,
    pos: start,
    title,
    onProgress,
    onDone,
    results: [],
    order: [],
    answered: false,
    qStart: 0,
    passageStart: {},
    lastEntry: null,
    played: false,
    timer: null,
    done: false,
  };
  if (location.hash === '#/quiz') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/quiz';
}

export function hasSession() {
  return !!S;
}

export function leaveQuiz() {
  if (!S) return;
  clearInterval(S.timer);
  tts.stop();
  S = null;
}

function showEn() {
  return getState().settings.showEn;
}

export function renderQuiz(root) {
  if (!S) {
    location.hash = '#/';
    return;
  }
  clearInterval(S.timer);
  tts.stop();
  while (S.pos < S.items.length && !DB.q[S.items[S.pos].id]) S.pos++;
  if (S.pos >= S.items.length) return renderSummary(root);

  const item = S.items[S.pos];
  const q = DB.q[item.id];
  const n = S.items.length;
  const p = q.passage ? DB.passages[q.passage] : null;
  const firstOfPassage = !!p && !S.passageStart[p.id];
  if (p && firstOfPassage) S.passageStart[p.id] = Date.now();
  const hiddenChoices = q.type === 'listening' && !q.printed;
  S.order = q.fixed ? q.choices.map((_, i) => i) : shuffle(q.choices.map((_, i) => i));
  S.answered = false;
  S.played = false;
  S.qStart = Date.now();
  const longChoices = q.type === 'usage' || q.choices.some(c => c.length > 14);

  root.innerHTML = `
  <div class="quiz${getState().settings.mincho ? ' mincho' : ''}">
    <div class="quiz-top">
      <button class="icon-btn" data-act="exit" aria-label="中断してホームへ">✕</button>
      <div class="qprog" aria-hidden="true"><i style="width:${(S.pos / n) * 100}%"></i></div>
      ${p ? '<span class="ptimer" id="ptimer"></span>' : ''}
      <span class="qcount">${S.pos + 1} / ${n}</span>
    </div>
    <div class="qmeta">
      <span class="qtype">${esc(typeLabel(q))}</span>
      ${q.level === 'N2' ? '<span class="tag">N2</span>' : ''}
      ${item.rt ? '<span class="tag rt">もう一度</span>' : ''}
    </div>
    ${p ? passageHTML(p) : ''}
    ${q.type === 'listening' ? listenHTML(q) : ''}
    ${q.q ? `<div class="qtext" id="qtext">${fmt(q.q)}</div>` : ''}
    <div class="choices${longChoices ? ' long' : ''}${hiddenChoices ? ' audio' : ''}">
      ${S.order
        .map((orig, i) => `<button class="choice" data-i="${orig}"><span class="num">${i + 1}</span><span class="ct">${hiddenChoices ? '' : fmt(q.choices[orig])}</span></button>`)
        .join('')}
    </div>
    <div id="feedback"></div>
    <div class="quiz-actions" id="actions" hidden>
      <button class="btn primary wide" data-act="next">${S.pos + 1 < n ? '次へ' : '結果を見る'}</button>
    </div>
  </div>`;

  $$('.choice', root).forEach(b => b.addEventListener('click', () => answer(Number(b.dataset.i), root)));
  $('[data-act="exit"]', root).addEventListener('click', exitQuiz);
  $('[data-act="next"]', root).addEventListener('click', next);
  const play = $('[data-act="play"]', root);
  if (play) play.addEventListener('click', () => playAudio(q, root));

  if (p) {
    const tick = () => {
      const el = $('#ptimer');
      if (!el) return;
      const ms = Date.now() - S.passageStart[p.id];
      el.textContent = `⏱ ${mmss(ms)} / ${mmss((p.target || 0) * 1000)}`;
      el.classList.toggle('over', p.target && ms > p.target * 1000);
    };
    tick();
    S.timer = setInterval(tick, 1000);
  }

  if (p && !firstOfPassage) $('#qtext')?.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
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
  if (!tts.supported) {
    return `<div class="listen fallback"><p class="note">この端末は音声読み上げに対応していません。スクリプトを読んで答えてください。</p>${scriptHTML(q, true)}</div>`;
  }
  const exam = getState().settings.examMode;
  return `<div class="listen">
    <button class="play" data-act="play" aria-label="音声を再生"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></button>
    <div>
      <div class="ltitle">${q.sub === 'response' ? '短い発話を聞いて、最もよい返事を選んでください' : '音声を聞いて答えてください'}</div>
      <div class="lnote" id="lnote">${exam ? '本番モード：再生は1回だけ' : '何度でも再生できます'}</div>
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
  const exam = getState().settings.examMode;
  if (exam && S.played && !S.answered) return;
  const btn = $('[data-act="play"]', root);
  const note = $('#lnote', root);
  btn.classList.add('playing');
  if (note) note.textContent = '再生中…';
  S.played = true;
  const ok = tts.speak(tts.partsFor(q, S.order), () => {
    btn.classList.remove('playing');
    if (note) note.textContent = exam && !S.answered ? '再生終了（本番モード）' : 'もう一度聞くには ▶';
    if (exam && !S.answered) btn.disabled = true;
  });
  if (!ok) {
    btn.classList.remove('playing');
    if (note) note.textContent = '日本語の音声が見つかりません（設定を確認）';
  }
}

function answer(chosen, root) {
  if (S.answered) return;
  S.answered = true;
  tts.stop();
  const item = S.items[S.pos];
  const q = DB.q[item.id];
  const ok = chosen === q.answer;
  let pt;
  if (q.passage) {
    const nextItem = S.items[S.pos + 1];
    const endsPassage = !nextItem || DB.q[nextItem.id]?.passage !== q.passage;
    if (endsPassage && !item.rt) {
      pt = Date.now() - S.passageStart[q.passage];
      clearInterval(S.timer);
    }
  }
  const e = recordAttempt({ id: q.id, ok, ch: chosen, ms: Date.now() - S.qStart, rt: item.rt, pt });
  S.lastEntry = e;
  if (!item.rt) S.results.push({ id: q.id, ok, t: e.t, ch: chosen });
  if (!ok && !item.rt && RETRY_TYPES.has(q.type)) S.items.push({ id: q.id, rt: true });

  $$('.choice', root).forEach(b => {
    const i = Number(b.dataset.i);
    b.disabled = true;
    if (i === q.answer) b.classList.add('correct');
    if (i === chosen && !ok) b.classList.add('wrong');
    const ct = $('.ct', b);
    if (!ct.textContent) ct.innerHTML = fmt(q.choices[i]);
  });
  $('.choices', root).classList.remove('audio');
  const pos = S.order.indexOf(q.answer) + 1;
  $('#feedback', root).innerHTML = `
    <div class="fb ${ok ? 'fb-ok' : 'fb-ng'}">
      <div class="fb-head">
        <span>${ok ? '○ 正解' : `× 不正解 — 正解は ${pos}`}</span>
        ${ok && !item.rt ? '<button class="chip" data-act="lucky" aria-pressed="false">まぐれだった</button>' : ''}
      </div>
      ${q.exp ? `<div class="exp">${fmt(q.exp)}</div>` : ''}
      ${q.en && showEn() ? `<div class="en">${esc(q.en)}</div>` : ''}
      ${q.type === 'listening' ? scriptHTML(q) : ''}
    </div>`;
  const lucky = $('[data-act="lucky"]', root);
  if (lucky) {
    lucky.addEventListener('click', () => {
      const on = lucky.getAttribute('aria-pressed') !== 'true';
      lucky.setAttribute('aria-pressed', String(on));
      lucky.textContent = on ? 'まぐれ ✓ 復習に回します' : 'まぐれだった';
      setLucky(e.t, on);
      const r = S.results.find(x => x.t === e.t);
      if (r) r.lucky = on;
    });
  }
  const play = $('[data-act="play"]', root);
  if (play) play.disabled = false;
  $('#actions', root).hidden = false;
  $('#feedback', root).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function next() {
  if (!S || !S.answered) return;
  S.pos++;
  S.onProgress?.(Math.min(S.pos, S.base));
  renderQuiz($('#view'));
}

function exitQuiz() {
  if (S) S.onProgress?.(Math.min(S.pos + (S.answered ? 1 : 0), S.base));
  if (S && S.results.length && !S.done) S.onDone?.();
  leaveQuiz();
  location.hash = '#/';
}

function renderSummary(root) {
  clearInterval(S.timer);
  if (!S.done) {
    S.done = true;
    S.onDone?.();
  }
  const res = S.results;
  const good = res.filter(r => r.ok && !r.lucky).length;
  const wrong = res.filter(r => !r.ok || r.lucky);
  const rate = res.length ? Math.round((good / res.length) * 100) : 0;
  root.innerHTML = `
  <div class="summary">
    <div class="sum-score ${rate >= 70 ? 'good' : rate >= 50 ? 'mid' : 'low'}">
      <div class="big">${good}<small> / ${res.length}</small></div>
      <div>${S.title ? esc(S.title) + '　' : ''}正答率 ${rate}%</div>
    </div>
    ${
      wrong.length
        ? `<h3>見直し（${wrong.length}）</h3>
           <ul class="wrong-list">${wrong
             .map(r => {
               const q = DB.q[r.id];
               return `<li><div class="wl-type">${esc(typeLabel(q))}${r.lucky ? ' ・まぐれ' : ''}</div>
                 <div class="wl-q">${esc(plain(q.q || q.ask || DB.passages[q.passage]?.title || '')).slice(0, 80)}</div>
                 <div class="wl-a">正解：${fmt(q.choices[q.answer])}</div></li>`;
             })
             .join('')}</ul>`
        : '<p class="center muted">全問正解。この調子。</p>'
    }
    <div class="sum-actions">
      ${wrong.length ? '<button class="btn" data-act="redo">間違えた問題を解き直す</button>' : ''}
      <button class="btn primary" data-act="home">ホームへ</button>
    </div>
  </div>`;
  $('[data-act="home"]', root).addEventListener('click', () => {
    leaveQuiz();
    location.hash = '#/';
  });
  const redo = $('[data-act="redo"]', root);
  if (redo) redo.addEventListener('click', () => startQuiz({ ids: wrong.map(r => r.id), title: '解き直し', retry: true }));
  window.scrollTo(0, 0);
}

export function quizKey(ev) {
  if (!S || location.hash !== '#/quiz') return;
  if (ev.target.closest('input, textarea, select')) return;
  const n = Number(ev.key);
  if (n >= 1 && n <= 4 && !S.answered) {
    const btn = $$('.choice')[n - 1];
    if (btn) btn.click();
  } else if ((ev.key === 'Enter' || ev.key === ' ') && S.answered) {
    ev.preventDefault();
    next();
  } else if (ev.key === 'p') {
    $('[data-act="play"]')?.click();
  }
}
