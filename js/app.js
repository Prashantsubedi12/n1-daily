import { load, save, getState, todayStr, diffDays, EXAM_DATE } from './store.js';
import { DB, loadData, latestDaily, learnFor } from './data.js';
import { buildRound, dueList, menuSizes, streak, aggregate, rate } from './engine.js';
import { startQuiz, renderQuiz, hasSession, leaveQuiz, quizKey } from './quiz.js';
import { viewPractice, viewReview, viewStats, viewSettings } from './pages.js';
import { $, $$, esc, fmt, toast, ago, pct } from './util.js';
import * as sync from './sync.js';
import * as tts from './speech.js';

const view = $('#view');

const MENU = [
  { key: 'review', title: '復習', sub: '間違えた・まぐれの問題' },
  { key: 'lang', title: '語彙・文法', sub: '問題1〜6（弱点を優先）' },
  { key: 'read', title: '読解', sub: '短文〜長文・時間を計る' },
  { key: 'listen', title: '聴解', sub: '音声読み上げ' },
];

// ---------- routing ----------

const ROUTES = {
  '': viewHome,
  learn: viewLearn,
  practice: () => viewPractice(view, runRound),
  review: () => viewReview(view, runRound),
  stats: () => viewStats(view, runRound),
  settings: () => viewSettings(view),
  quiz: () => renderQuiz(view),
};

function route() {
  const name = location.hash.replace(/^#\/?/, '');
  if (name !== 'quiz' && hasSession()) leaveQuiz();
  document.body.classList.toggle('in-quiz', name === 'quiz');
  $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === (name || 'home')));
  (ROUTES[name] || viewHome)();
  if (name !== 'quiz') window.scrollTo(0, 0);
}

// ---------- rounds ----------

export function runRound(kind, arg, title) {
  const ids = buildRound(kind, arg);
  if (!ids.length) {
    toast('出題できる問題がありません');
    return;
  }
  startQuiz({ ids, title, onDone: afterRound });
}

function startMenu(key) {
  const st = getState();
  const today = todayStr();
  const plans = (st.plans[today] ||= {});
  let p = plans[key];
  if (!p || p.pos >= p.ids.length) {
    const ids = buildRound(key);
    if (!ids.length) {
      toast(key === 'review' ? '今日の復習はありません' : '出題できる問題がありません');
      return;
    }
    p = plans[key] = { ids, pos: 0, rounds: p ? p.rounds + 1 : 0 };
    save();
  }
  const item = MENU.find(m => m.key === key);
  startQuiz({
    ids: p.ids,
    start: p.pos,
    title: item.title,
    onProgress: pos => {
      p.pos = pos;
      save();
    },
    onDone: afterRound,
  });
}

function afterRound() {
  if (!sync.configured()) return;
  sync.syncNow().then(r => {
    if (!r.ok && r.msg !== 'オフライン' && r.msg !== '同期中') toast(r.msg);
  });
}

// ---------- home ----------

function viewHome() {
  const st = getState();
  const today = todayStr();
  const dLeft = diffDays(today, EXAM_DATE);
  const daily = latestDaily(today);
  const sizes = menuSizes();
  const plans = st.plans[today] || {};
  const due = dueList().length;
  const todays = st.log.filter(e => e.d === today && !e.rt);
  const todayGood = todays.filter(e => e.ok && !e.lk).length;
  const learn = learnFor(today);
  const learnedToday = learn.cards.filter(c => st.learned[c.id]).length;
  const agg = aggregate(14);

  const status = key => {
    const p = plans[key];
    if (p && p.pos >= p.ids.length) return { cls: 'done', text: `✓ 完了${p.rounds ? ' ×' + (p.rounds + 1) : ''}`, more: true };
    if (p && p.pos > 0) return { cls: 'doing', text: `${p.pos} / ${p.ids.length}` };
    if (key === 'review') return due ? { cls: '', text: `${Math.min(due, sizes.review)}問` } : { cls: 'done', text: 'なし' };
    if (key === 'read') return { cls: '', text: `約${sizes.read}問` };
    return { cls: '', text: `${sizes[key]}問` };
  };

  const dayNo = DB.index?.start ? diffDays(DB.index.start, today) + 1 : null;

  view.innerHTML = `
  <section class="hero">
    <div>
      <div class="muted small">${today.replace(/-/g, '.')}${dayNo > 0 ? `　Day ${dayNo}` : ''}</div>
      <h1>N1 Daily</h1>
    </div>
    <div class="countdown" title="試験日 ${EXAM_DATE}">
      <span class="small">本番まで</span>
      <b>${dLeft > 0 ? dLeft : dLeft === 0 ? '当日' : '終了'}</b>
      <span class="small">${dLeft > 0 ? '日' : ''}</span>
    </div>
  </section>

  ${
    daily?.report
      ? `<section class="card report">
          <div class="card-label">今日のポイント${daily.date !== today ? `（${daily.date.slice(5).replace('-', '/')}）` : ''}</div>
          <div class="report-text">${fmt(daily.report)}</div>
        </section>`
      : ''
  }

  <section class="card">
    <div class="row between">
      <div class="card-label">今日のメニュー</div>
      <div class="small muted">${todays.length}問 解答・正答 ${todays.length ? Math.round((todayGood / todays.length) * 100) : 0}%</div>
    </div>
    <ul class="menu">
      <li><a class="menu-item${learn.cards.length && learnedToday >= learn.cards.length ? ' done' : ''}" href="#/learn">
        <span class="mi-icon">新</span>
        <span class="mi-body"><b>今日の新出</b><span class="small muted">文法・語彙カード${learn.cards.length ? `（${learn.cards.length}枚）` : ''}</span></span>
        <span class="mi-stat">${learn.cards.length ? (learnedToday >= learn.cards.length ? '✓ 完了' : `${learnedToday} / ${learn.cards.length}`) : '—'}</span>
      </a></li>
      ${MENU.map((m, i) => {
        const s = status(m.key);
        return `<li><button class="menu-item ${s.cls}" data-menu="${m.key}">
          <span class="mi-icon">${i + 1}</span>
          <span class="mi-body"><b>${m.title}</b><span class="small muted">${m.sub}</span></span>
          <span class="mi-stat">${s.text}${s.more ? '<small>もう1セット ›</small>' : ''}</span>
        </button></li>`;
      }).join('')}
    </ul>
  </section>

  <section class="stat-row">
    <div class="stat"><b>${streak()}</b><span>連続日数</span></div>
    <div class="stat"><b>${due}</b><span>復習待ち</span></div>
    <div class="stat"><b>${pct(rate(agg.sec.read))}</b><span>読解 正答率</span></div>
  </section>

  <section class="sync-line small muted">
    ${
      sync.configured()
        ? `同期：${st.sync.error ? `<span class="ng">${esc(st.sync.error)}</span>` : ago(st.sync.last)}`
        : `<a href="#/settings">GitHub同期を設定</a>すると、毎日の問題があなたの弱点に合わせて作られます`
    }
    <a class="gear" href="#/settings" aria-label="設定">設定 ›</a>
  </section>`;

  $$('[data-menu]', view).forEach(b => b.addEventListener('click', () => startMenu(b.dataset.menu)));
}

// ---------- learn ----------

function viewLearn() {
  const st = getState();
  const today = todayStr();
  const { date, cards } = learnFor(today);
  const grammar = cards.filter(c => c.kind === 'grammar');
  const vocab = cards.filter(c => c.kind === 'vocab');
  const pastDates = [...new Set(DB.learn.map(c => c.date))].filter(d => d && d < (date || today)).sort().reverse();

  const card = c => {
    const done = !!st.learned[c.id];
    if (c.kind === 'grammar') {
      return `<details class="lcard${done ? ' learned' : ''}" data-id="${c.id}">
        <summary><span class="lc-main">${esc(c.point)}</span><span class="lc-sub">${esc(c.connect || '')}</span></summary>
        <div class="lc-body">
          <p class="lc-mean">${esc(c.ja)}</p>
          ${c.en && st.settings.showEn ? `<p class="en">${esc(c.en)}</p>` : ''}
          ${(c.ex || []).map(x => `<p class="lc-ex"><button class="say" data-say="${esc(x)}" aria-label="読み上げ">🔊</button>${fmt(x)}</p>`).join('')}
          ${c.note ? `<p class="lc-note">${fmt(c.note)}</p>` : ''}
          ${c.vs ? `<p class="lc-note">似ている表現：${esc(c.vs)}</p>` : ''}
          <label class="check"><input type="checkbox" data-learn="${c.id}"${done ? ' checked' : ''}> 覚えた</label>
        </div>
      </details>`;
    }
    return `<details class="lcard vocab${done ? ' learned' : ''}" data-id="${c.id}">
      <summary><span class="lc-main">${esc(c.w)}</span><span class="lc-sub">タップで読みと意味</span></summary>
      <div class="lc-body">
        <p class="lc-read">${esc(c.r)}${c.pos ? `<span class="small muted">　${esc(c.pos)}</span>` : ''}</p>
        <p class="lc-mean">${esc(c.ja || '')}</p>
        ${c.en && st.settings.showEn ? `<p class="en">${esc(c.en)}</p>` : ''}
        ${c.ex ? `<p class="lc-ex"><button class="say" data-say="${esc(c.ex)}" aria-label="読み上げ">🔊</button>${fmt(c.ex)}</p>` : ''}
        <label class="check"><input type="checkbox" data-learn="${c.id}"${done ? ' checked' : ''}> 覚えた</label>
      </div>
    </details>`;
  };

  const tags = cards.map(c => c.point || c.w);
  const quizCount = DB.list.filter(q => !q.passage && (q.tags || []).some(t => tags.includes(t))).length;

  view.innerHTML = `
  <h2 class="page-title">今日の新出 <span class="small muted">${date ? date.slice(5).replace('-', '/') : ''}</span></h2>
  ${!cards.length ? '<p class="muted">新出カードはまだありません。</p>' : ''}
  ${grammar.length ? `<h3 class="sec-title">文法 <span class="muted small">${grammar.length}</span></h3>${grammar.map(card).join('')}` : ''}
  ${vocab.length ? `<h3 class="sec-title">語彙 <span class="muted small">${vocab.length}</span></h3>${vocab.map(card).join('')}` : ''}
  ${quizCount ? `<button class="btn primary wide" id="learnQuiz">新出の確認問題を解く（${Math.min(quizCount, 12)}問）</button>` : ''}
  ${
    pastDates.length
      ? `<h3 class="sec-title">これまでの新出</h3>
        <ul class="past-days">${pastDates
          .map(d => {
            const cs = DB.learn.filter(c => c.date === d);
            const n = cs.filter(c => st.learned[c.id]).length;
            return `<li><button class="link-row" data-day="${d}"><span>${d.slice(5).replace('-', '/')}</span><span class="muted small">${cs.map(c => c.point || c.w).slice(0, 4).join('・')}…</span><span class="small">${n}/${cs.length}</span></button></li>`;
          })
          .join('')}</ul>`
      : ''
  }`;

  $$('[data-learn]', view).forEach(cb =>
    cb.addEventListener('change', () => {
      if (cb.checked) st.learned[cb.dataset.learn] = today;
      else delete st.learned[cb.dataset.learn];
      cb.closest('.lcard').classList.toggle('learned', cb.checked);
      save();
    }),
  );
  $$('[data-say]', view).forEach(b =>
    b.addEventListener('click', ev => {
      ev.preventDefault();
      tts.speak([{ who: 'F', text: b.dataset.say.replace(/__|\*\*/g, '') }]);
    }),
  );
  $('#learnQuiz')?.addEventListener('click', () => runRound('tag', tags, '新出の確認'));
  $$('[data-day]', view).forEach(b =>
    b.addEventListener('click', () => {
      const d = b.dataset.day;
      const t = DB.learn.filter(c => c.date === d).map(c => c.point || c.w);
      runRound('tag', t, `${d.slice(5).replace('-', '/')} の新出`);
    }),
  );
}

// ---------- boot ----------

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // A new deploy's worker takes over while this page still runs the old code.
    // Reload once so the new code runs now (iOS home-screen apps rarely do a real reload).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || location.hash.startsWith('#/quiz')) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('sw', err));
  }
}

async function boot() {
  load();
  const s = getState().settings;
  document.body.classList.toggle('big', !!s.big);
  registerSW();
  document.addEventListener('keydown', quizKey);
  try {
    await loadData();
  } catch (e) {
    view.innerHTML = `<div class="card"><p>問題データを読み込めませんでした。</p><p class="small muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">再読み込み</button></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  if (sync.configured() && sync.hasPending()) sync.syncNow();
  window.addEventListener('online', () => sync.configured() && sync.syncNow());
}

boot();
