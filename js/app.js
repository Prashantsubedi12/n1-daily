import { load, save, getState, getPersistenceError, setLearned, todayStr, diffDays, addDays, EXAM_DATE, logEvent } from './store.js';
import { DB, loadData, loadArchive, hasMoreArchive, contentDateJst, contentStatus, learnFor } from './data.js';
import { buildRound, dueList, menuSizes, aggregate, rate, evidence, recommendReading } from './engine.js';
import { startQuiz, renderQuiz, hasSession, leaveQuiz, quizKey, questList, restoreQuiz, activeQuiz, resumeQuiz, savedQuizQuestionIds } from './quiz.js';
import { viewMatch, leaveMatch } from './match.js';
import { progress, todayQuests, newBadges } from './game.js';
import { viewPractice, viewReview, viewStats, viewSettings, viewFeedback } from './pages.js';
import { $, $$, esc, fmt, toast, pct } from './util.js';
import { MIN_ANSWERS, MIN_TYPES, MIN_PASSAGES } from './estimate.js';
import * as tts from './speech.js';
import { mascot, greeting, ring, sparkle, confetti } from './coach.js';

const view = $('#view');
let waitingWorker;
let offlineReady = false;
let applyingUpdate = false;
let updateActivated = false;

const SECTION_SHORT = { lang: '言語知識', read: '読解', listen: '聴解' };

const MENU = [
  { key: 'review', title: '復習', sub: '間違えた・まぐれの問題', icon: '🔁' },
  { key: 'lang', title: '語彙・文法', sub: '問題1〜6（弱点を優先）', icon: '📝' },
  { key: 'read', title: '読解', sub: '短文〜長文・時間を計る', icon: '📖' },
  { key: 'listen', title: '聴解', sub: '音声読み上げ', icon: '🎧' },
];

// ---------- routing ----------

const ROUTES = {
  '': viewHome,
  learn: viewLearn,
  practice: () => viewPractice(view, runRound),
  review: () => viewReview(view, runRound),
  stats: () => viewStats(view, runRound),
  settings: () => viewSettings(view),
  feedback: () => viewFeedback(view),
  quiz: () => renderQuiz(view),
  match: () => viewMatch(view),
};

function routeName() {
  const name = location.hash.replace(/^#\/?/, '');
  return Object.hasOwn(ROUTES, name) ? name : '';
}

function route(event) {
  const name = routeName();
  if (name !== 'quiz' && hasSession()) leaveQuiz();
  if (name !== 'match') leaveMatch();
  if (!name && updateActivated) {
    location.reload();
    return;
  }
  document.body.classList.toggle('in-quiz', name === 'quiz' || name === 'match');
  $$('#tabbar a').forEach(a => {
    const current = a.dataset.tab === (name || 'home');
    a.classList.toggle('active', current);
    if (current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  ROUTES[name]();
  if (name !== 'quiz') {
    window.scrollTo(0, 0);
    if (event) view.focus({ preventScroll: true });
  }
}

// ---------- rounds ----------

export function runRound(kind, arg, title) {
  const ids = buildRound(kind, arg);
  if (!ids.length) {
    toast('出題できる問題がありません');
    return;
  }
  openRound({ ids, title, context: { kind, key: Array.isArray(arg) ? arg.join('・') : String(arg ?? '') } });
}

function startMenu(key) {
  const st = getState();
  const today = todayStr();
  const existing = activeQuiz();
  if (existing?.kind === 'menu' && existing.key === `${today}/${key}`) return resumeQuiz();
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
  openRound({
    ids: p.ids,
    start: p.pos,
    title: item.title,
    context: { kind: 'menu', key: `${today}/${key}` },
  });
}

function bindRound({ kind = 'practice', key = '' } = {}) {
  const [date, menu] = kind === 'menu' ? key.split('/') : [];
  const plan = getState().plans[date]?.[menu];
  const m = menu || kind;
  return {
    onProgress: plan ? pos => {
      plan.pos = pos;
    } : undefined,
    onDone: info => logEvent('end', { m, ...(kind === 'priority' ? { priorityDate: key } : {}), ...info }, { eventId: `end:${info.roundId}`, persist: false }),
  };
}

function openRound({ ids, start, title, context }) {
  const existing = activeQuiz();
  if (existing && !window.confirm('途中のラウンドがあります。保存済みの解答は残し、新しいラウンドを始めますか？')) return;
  logEvent('start', { m: context.kind === 'menu' ? context.key.split('/')[1] : context.kind, n: ids.length - (start || 0) });
  startQuiz({ ids, start, title, context, ...bindRound(context) });
}

// ---------- home ----------

function viewHome() {
  const st = getState();
  const today = todayStr();
  const contentDay = contentDateJst();
  const dLeft = diffDays(today, EXAM_DATE);
  const pack = contentStatus(contentDay);
  const recommended = recommendReading(contentDay, { bankOnly: pack.state !== 'current' }) || recommendReading(contentDay);
  const draft = activeQuiz();
  const priorityDraft = draft?.kind === 'priority';
  const priorityDone = st.events.some(e => e.k === 'end' && e.fin && e.priorityDate === contentDay);
  const sizes = menuSizes();
  const plans = st.plans[today] || {};
  const due = dueList().length;
  const todays = st.log.filter(e => e.d === today && !e.rt);
  const todayGood = todays.filter(e => e.ok && !e.lk).length;
  const learn = learnFor(contentDay);
  const learnedToday = learn.cards.filter(c => st.learned[c.id]).length;
  const agg = aggregate(14);
  const first = evidence();
  const news = (DB.changelog || [])[0];
  const freshNews = news && news.date >= addDays(today, -6);
  const goal = st.settings.daily;
  const g = progress();
  const days = g.streak;
  const quests = todayQuests();
  const hi = greeting({ hour: new Date().getHours(), todays: todays.length, goal, due, streak: days });

  const evidenceRow = key => {
    const sec = first[key];
    return `<div class="est-row">
      <span class="est-name">${SECTION_SHORT[key]}</span>
      <span class="small muted">${sec.n}問・${sec.types}形式${key === 'read' ? `・${sec.passages}文章` : ''}</span>
      <b class="est-num"${sec.accuracy == null ? ' aria-label="データ不足"' : ''}>${sec.accuracy == null ? '—' : pct(sec.accuracy)}</b>
    </div>`;
  };

  const status = key => {
    const p = plans[key];
    if (p && p.pos >= p.ids.length) return { cls: 'done', text: `✓ 完了${p.rounds ? ' ×' + (p.rounds + 1) : ''}`, more: true };
    if (p && p.pos > 0) return { cls: 'doing', text: `${p.pos} / ${p.ids.length}` };
    if (key === 'review') return due ? { cls: '', text: `${Math.min(due, sizes.review)}問` } : { cls: 'done', text: 'なし' };
    if (key === 'read') return { cls: '', text: `約${sizes.read}問` };
    return { cls: '', text: `${sizes[key]}問` };
  };

  const dayNo = DB.index?.start ? diffDays(DB.index.start, today) + 1 : null;
  const packNotice = pack.state === 'current' && !pack.unavailable.length ? '' : pack.state === 'current'
    ? '一部の教材を読み込めませんでした。利用できる問題で練習できます。'
    : pack.date ? `本日分は利用できません。最新の教材は ${pack.date.replace(/-/g, '/')} です。`
    : '本日分は利用できません。問題集から練習できます。';

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

  <section class="card priority" aria-labelledby="priority-title">
    <p class="priority-label">今日の最優先</p>
    <h2 id="priority-title">${priorityDraft ? '読解の続き' : '短文で根拠をつかむ'}</h2>
    <p class="priority-meta">${priorityDraft ? `途中のセッション・${draft.total}問` : recommended ? `読解・短文　約${recommended.minutes}分` : '読解・短文'}</p>
    <p class="priority-reason">${priorityDraft ? '保存したところから再開できます。'
      : priorityDone ? '今日の読解ミッションをクリアしました。'
      : recommended ? esc(recommended.reason) : '短文を読み込めませんでした。練習メニューから利用できる問題を選べます。'}</p>
    ${priorityDraft || (!priorityDone && recommended) ? `<button class="btn primary wide" id="priorityStart">${priorityDraft ? '続きから' : '読解を始める'} <span aria-hidden="true">›</span></button>`
      : priorityDone ? '<a class="btn wide" href="#/review">復習を見る</a>' : '<a class="btn wide" href="#/practice">練習を見る</a>'}
    <p class="small muted" id="offlineReady" role="status">${offlineReady ? 'オフラインで基本教材を利用できます' : ''}</p>
  </section>

  ${draft && !priorityDraft ? `<button class="btn wide resume-round" id="resumeRound">続きから <span class="small muted">${esc(draft.title || '途中の練習')}</span></button>` : ''}
  ${packNotice ? `<div class="content-status small muted"><p>${packNotice}</p><button class="btn" id="retryContent">教材を再確認</button></div>` : ''}
  <button class="btn wide" id="applyUpdate" ${waitingWorker ? '' : 'hidden'}>更新を適用</button>

  <section class="card buddy">
    ${mascot(hi.mood, 'md float')}
    <div class="bubble">${esc(hi.text)}</div>
    <div class="goal" title="今日の目標 ${goal}問">
      ${ring(todays.length, goal)}
      <div class="goal-num"><b>${todays.length}</b><small>/${goal}</small></div>
      <div class="goal-cap">${days ? `🔥${days}日連続` : '今日の目標'}</div>
    </div>
    <div class="lvl-row">
      <span class="lvl">Lv.${g.level}</span>
      <span class="small"><b>${esc(g.title)}</b></span>
      <div class="bar-track"><i style="width:${Math.round((g.into / g.need) * 100)}%"></i></div>
      <span class="small muted">⚡${g.todayXp} XP 今日</span>
      ${g.freezes ? `<span class="small" title="ストリーク・フリーズ：休んだ日も連続記録を守ります">🧊×${g.freezes}</span>` : ''}
    </div>
  </section>

  <section class="card">
    <div class="row between">
      <div class="card-label">📚 今日のメニュー</div>
      <div class="small muted">${todays.length}問 解答・正答 ${todays.length ? Math.round((todayGood / todays.length) * 100) : 0}%</div>
    </div>
    <ul class="menu">
      <li><a class="menu-item${learn.cards.length && learnedToday >= learn.cards.length ? ' done' : ''}" href="#/learn">
        <span class="mi-icon">✨</span>
        <span class="mi-body"><b>${learn.date === contentDay ? '今日の新出' : '新出カード'}</b><span class="small muted">文法・語彙カード${learn.cards.length ? `（${learn.cards.length}枚）` : ''}</span></span>
        <span class="mi-stat">${learn.cards.length ? (learnedToday >= learn.cards.length ? '✓ 完了' : `${learnedToday} / ${learn.cards.length}`) : '—'}</span>
      </a></li>
      ${MENU.map(m => {
        const s = status(m.key);
        return `<li><button class="menu-item ${s.cls}" data-menu="${m.key}">
          <span class="mi-icon">${m.icon}</span>
          <span class="mi-body"><b>${m.title}</b><span class="small muted">${m.sub}</span></span>
          <span class="mi-stat">${s.text}${s.more ? '<small>もう1セット ›</small>' : ''}</span>
        </button></li>`;
      }).join('')}
    </ul>
  </section>

  <section class="card quests">
    <div class="row between">
      <div class="card-label">🎁 今日のクエスト</div>
      <div class="small muted">${quests.filter(q => q.done).length}/3${quests.every(q => q.done) ? '・🧊ゲット' : '・全部で🧊フリーズ'}</div>
    </div>
    ${questList(quests, quests.map(q => q.done))}
    <a class="btn wide match-btn" href="#/match">🧩 漢字マッチで遊ぶ</a>
  </section>

  <section class="card coach">
    <div class="card-label">N1 初回正答率 <span class="muted small">直近14日${Object.values(first).every(s => s.accuracy == null) ? '・データ不足' : ''}</span></div>
    ${['lang', 'read', 'listen'].map(evidenceRow).join('')}
    <p class="small muted">各分野${MIN_ANSWERS}問・${MIN_TYPES}形式以上（読解は${MIN_PASSAGES}文章以上）で表示します。本試験の換算点とは別の練習指標です。</p>
  </section>

  ${
    freshNews
      ? `<a class="card news" href="#/feedback"><span class="tag">更新</span><span><b>${esc(news.title)}</b><span class="small muted">　${news.date.slice(5).replace('-', '/')}</span></span></a>`
      : ''
  }

  <section class="stat-row">
    <div class="stat"><b>${days}</b><span>🔥 連続日数</span></div>
    <div class="stat"><b>${due}</b><span>🔁 復習待ち</span></div>
    <div class="stat"><b>${pct(rate(agg.sec.read))}</b><span>📖 読解 練習正答率</span></div>
  </section>

  <section class="sync-line small muted">
    <span>学習記録はこの端末に保存</span>
    <span><a class="gear" href="#/feedback">意見・更新</a>　<a class="gear" href="#/settings" aria-label="設定">設定 ›</a></span>
  </section>`;

  $$('[data-menu]', view).forEach(b => b.addEventListener('click', () => startMenu(b.dataset.menu)));
  $('#priorityStart', view)?.addEventListener('click', () => {
    if (priorityDraft) return resumeQuiz();
    openRound({ ids: recommended.ids, title: '今日の最優先・読解', context: { kind: 'priority', key: contentDay } });
  });
  $('#resumeRound', view)?.addEventListener('click', resumeQuiz);
  $('#retryContent', view)?.addEventListener('click', () => location.reload());
  $('#applyUpdate', view)?.addEventListener('click', event => {
    if (!waitingWorker || applyingUpdate) return;
    applyingUpdate = true;
    event.currentTarget.disabled = true;
    waitingWorker.postMessage({ type: 'APPLY_UPDATE' });
  });
  const fresh = newBadges();
  if (fresh.length) {
    confetti();
    toast(`🏅 新しいバッジ：${fresh.map(b => b.icon + b.name).join('・')}`);
  }
}

// ---------- learn ----------

function viewLearn() {
  const st = getState();
  const today = contentDateJst();
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
  <h2 class="page-title">${date === today ? '今日の新出' : '新出カード'} <span class="small muted">${date ? date.slice(5).replace('-', '/') : ''}</span></h2>
  ${!cards.length ? '<p class="muted">新出カードはまだありません。</p>' : ''}
  ${grammar.length ? `<h3 class="sec-title">文法 <span class="muted small">${grammar.length}</span></h3>${grammar.map(card).join('')}` : ''}
  ${vocab.length ? `<h3 class="sec-title">語彙 <span class="muted small">${vocab.length}</span></h3>${vocab.map(card).join('')}` : ''}
  ${quizCount ? `<button class="btn primary wide" id="learnQuiz">新出の確認問題を解く（${Math.min(quizCount, 12)}問）</button>` : ''}
  <a class="btn wide" href="#/match">🧩 漢字マッチで読みを覚える</a>
  ${
    pastDates.length
      ? `<h3 class="sec-title">これまでの新出</h3>
        <ul class="past-days">${pastDates
          .map(d => {
            const cs = DB.learn.filter(c => c.date === d);
            const n = cs.filter(c => st.learned[c.id]).length;
            return `<li><button class="link-row" data-day="${d}"><span>${d.slice(5).replace('-', '/')}</span><span class="muted small">${esc(cs.map(c => c.point || c.w).slice(0, 4).join('・'))}…</span><span class="small">${n}/${cs.length}</span></button></li>`;
          })
          .join('')}</ul>`
      : ''
  }
  ${hasMoreArchive() ? '<button class="btn wide" id="loadArchive">過去の教材を読み込む</button>' : ''}`;

  $$('[data-learn]', view).forEach(cb =>
    cb.addEventListener('change', () => {
      setLearned(cb.dataset.learn, cb.checked);
      cb.closest('.lcard').classList.toggle('learned', cb.checked);
      if (!cb.checked) return;
      sparkle(cb);
      if (cards.every(c => st.learned[c.id])) {
        confetti();
        toast('今日の新出コンプリート🎉');
      }
    }),
  );
  $$('[data-say]', view).forEach(b =>
    b.addEventListener('click', ev => {
      ev.preventDefault();
      tts.speak([{ who: 'F', text: b.dataset.say.replace(/__|\*\*/g, '') }]);
    }),
  );
  $('#learnQuiz')?.addEventListener('click', () => runRound('tag', tags, '新出の確認'));
  $('#loadArchive', view)?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '読み込み中…';
    try {
      await loadArchive();
      if (button.isConnected) {
        viewLearn();
        view.focus({ preventScroll: true });
        if (hasMoreArchive()) toast('一部の教材を読み込めませんでした。');
      }
    } catch {
      button.disabled = false;
      button.textContent = '過去の教材を読み込む';
      toast('過去の教材を読み込めませんでした。');
    }
  });
  $$('[data-day]', view).forEach(b =>
    b.addEventListener('click', () => {
      const d = b.dataset.day;
      const t = DB.learn.filter(c => c.date === d).map(c => c.point || c.w);
      runRound('tag', t, `${d.slice(5).replace('-', '/')} の新出`);
    }),
  );
}

// ---------- boot ----------

// One 'open' event per 30 minutes of use, so the analysis can see days the app was opened but not studied.
let lastOpen = 0;
function noteOpen() {
  if (Date.now() - lastOpen < 30 * 60 * 1000) return;
  lastOpen = Date.now();
  logEvent('open');
}

function checkOfflineStatus() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return;
  const { port1, port2 } = new MessageChannel();
  const timeout = setTimeout(() => port1.close(), 3000);
  port1.onmessage = ({ data }) => {
    clearTimeout(timeout);
    port1.close();
    if (data?.type !== 'OFFLINE_STATUS') return;
    offlineReady = data.ready === true;
    const status = $('#offlineReady', view);
    if (status) status.textContent = offlineReady ? 'オフラインで基本教材を利用できます' : '';
  };
  worker.postMessage({ type: 'OFFLINE_STATUS' }, [port2]);
}

async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applyingUpdate) {
      updateActivated = true;
      if (!routeName()) location.reload();
    } else checkOfflineStatus();
  });
  try {
    const registration = await navigator.serviceWorker.register('sw.js');
    const showWaiting = () => {
      waitingWorker = navigator.serviceWorker.controller && registration.waiting;
      const button = $('#applyUpdate', view);
      if (button) button.hidden = !waitingWorker;
    };
    showWaiting();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', showWaiting);
    });
    checkOfflineStatus();
  } catch (err) {
    console.warn('sw', err);
  }
}

function renderPersistenceStatus() {
  const status = $('#persistenceStatus');
  if (!status) return;
  const message = getPersistenceError();
  status.textContent = message;
  status.hidden = !message;
}

async function boot() {
  document.addEventListener('n1daily:persistence-error', renderPersistenceStatus);
  load();
  renderPersistenceStatus();
  const st = getState();
  document.body.classList.toggle('big', !!st.settings.big);
  registerSW();
  document.addEventListener('keydown', quizKey);
  try {
    const planIds = Object.values(st.plans).flatMap(day => Object.values(day).flatMap(plan => plan.ids));
    const learnedDates = Object.values(st.learned);
    await loadData({ questionIds: [...st.log.map(a => a.id), ...planIds, ...savedQuizQuestionIds()], learnedDates });
  } catch {
    view.innerHTML = '<div class="card"><p>問題データを読み込めませんでした。接続を確認して、もう一度お試しください。</p><button class="btn" id="retryLoad">再読み込み</button></div>';
    $('#retryLoad', view).addEventListener('click', () => location.reload());
    return;
  }
  restoreQuiz(bindRound);
  window.addEventListener('hashchange', route);
  route();
  noteOpen();
  window.addEventListener('online', checkOfflineStatus);
  let lastDay = `${todayStr()}/${contentDateJst()}`;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    noteOpen();
    checkOfflineStatus();
    const day = `${todayStr()}/${contentDateJst()}`;
    if (lastDay !== day && !routeName()) viewHome();
    lastDay = day;
  });
}

boot();
