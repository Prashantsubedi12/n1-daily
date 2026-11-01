import { DB } from './data.js';
import { getState, save, srs, isMastered, todayStr, addDays, diffDays, EXAM_DATE, APP_VERSION, replaceState } from './store.js';
import { TYPES, SUBS, SECTIONS, aggregate, rate, weakTags, wrongList, dueList, typeLabel, readingSpeed, secOf } from './engine.js';
import { $, $$, esc, fmt, plain, pct, toast, ago, mmss } from './util.js';
import * as sync from './sync.js';
import * as tts from './speech.js';

// ---------- 練習: by question type ----------

export function viewPractice(view, runRound) {
  const s = srs();
  const agg = aggregate(0);
  const rows = [];
  const row = (key, label, pool, a) => {
    const seen = pool.filter(q => s[q.id]).length;
    rows.push({ key, label, total: pool.length, seen, a });
  };
  const groups = { lang: [], read: [], listen: [] };
  for (const [type, info] of Object.entries(TYPES)) {
    const pool = DB.list.filter(q => q.type === type);
    if (!pool.length) continue;
    if (SUBS[type]) {
      for (const [sub, label] of Object.entries(SUBS[type])) {
        const sp = pool.filter(q => q.sub === sub);
        if (!sp.length) continue;
        groups[info.sec].push({ key: `${type}:${sub}`, label, pool: sp, a: agg.sub[`${type}:${sub}`] });
      }
    } else {
      groups[info.sec].push({ key: type, label: `${info.mondai} ${info.label}`, pool, a: agg.type[type] });
    }
  }
  const n2 = DB.list.filter(q => q.level === 'N2');
  const weak = weakTags(aggregate(14));

  const list = items =>
    items
      .map(g => {
        const seen = g.pool.filter(q => s[q.id]).length;
        return `<li><button class="link-row" data-type="${g.key}">
          <span>${esc(g.label)}</span>
          <span class="small muted">${seen}/${g.pool.length}</span>
          <span class="acc ${accClass(rate(g.a))}">${pct(rate(g.a))}</span>
        </button></li>`;
      })
      .join('');

  view.innerHTML = `
    <h2 class="page-title">分野別練習</h2>
    <p class="small muted">右の数字は解いた数 / 問題数、全期間の正答率。</p>
    ${Object.entries(groups)
      .filter(([, items]) => items.length)
      .map(([sec, items]) => `<h3 class="sec-title">${SECTIONS[sec]}</h3><ul class="rows">${list(items)}</ul>`)
      .join('')}
    ${n2.length ? `<h3 class="sec-title">N2 復習</h3><ul class="rows"><li><button class="link-row" data-n2><span>N2 文法・語彙ミックス</span><span class="small muted">${n2.filter(q => s[q.id]).length}/${n2.length}</span><span></span></button></li></ul>` : ''}
    ${
      weak.length
        ? `<h3 class="sec-title">弱点（直近14日）</h3><div class="chips">${weak
            .map(w => `<button class="chip" data-tag="${esc(w.tag)}">${esc(w.tag)} <small>${w.c}/${w.n}</small></button>`)
            .join('')}</div>`
        : ''
    }`;

  $$('[data-type]', view).forEach(b => b.addEventListener('click', () => runRound('type', b.dataset.type, b.querySelector('span').textContent)));
  $('[data-n2]', view)?.addEventListener('click', () => runRound('n2', null, 'N2 復習'));
  $$('[data-tag]', view).forEach(b => b.addEventListener('click', () => runRound('tag', b.dataset.tag, b.dataset.tag)));
}

function accClass(r) {
  if (r == null) return '';
  return r >= 0.7 ? 'good' : r >= 0.5 ? 'mid' : 'low';
}

// ---------- 復習: mistake notebook ----------

export function viewReview(view, runRound) {
  const s = srs();
  const due = dueList();
  const wrong = wrongList();
  view.innerHTML = `
    <h2 class="page-title">復習</h2>
    <div class="card">
      <div class="row between">
        <div><b>${due.length}</b> 問が復習のタイミング</div>
        <button class="btn primary" id="dueBtn"${due.length ? '' : ' disabled'}>解く</button>
      </div>
      <p class="small muted">間違えた問題は 1日後 → 2日後 → 4日後 → 7日後… と間隔を空けて出ます。</p>
    </div>
    <div class="row between">
      <h3 class="sec-title">間違いノート <span class="muted small">${wrong.length}</span></h3>
      ${wrong.length ? '<button class="btn small" id="allWrong">まとめて解く</button>' : ''}
    </div>
    ${!wrong.length ? '<p class="muted">まだありません。間違えた問題・「まぐれ」にした問題がここに溜まります。</p>' : ''}
    <ul class="notebook">${wrong
      .slice(0, 150)
      .map(q => {
        const st = s[q.id];
        const mine = st.lastCh != null && q.choices[st.lastCh] != null ? q.choices[st.lastCh] : 'まぐれ';
        const head = q.q || q.ask || (q.passage ? DB.passages[q.passage]?.title || '読解' : '');
        return `<li><details>
          <summary>
            <span class="nb-type">${esc(typeLabel(q))}・${st.lastWrongD?.slice(5).replace('-', '/') || ''}</span>
            <span class="nb-q">${esc(plain(head)).slice(0, 90)}</span>
            <span class="nb-a"><span class="ng">✕ ${esc(plain(mine))}</span>　<span class="ok">○ ${esc(plain(q.choices[q.answer]))}</span></span>
          </summary>
          <div class="nb-body">
            ${q.q ? `<p>${fmt(q.q)}</p>` : ''}
            ${q.exp ? `<p class="exp">${fmt(q.exp)}</p>` : ''}
            ${q.en && getState().settings.showEn ? `<p class="en">${esc(q.en)}</p>` : ''}
            <p class="small muted">解答 ${st.n}回・正解 ${st.c}回</p>
          </div>
        </details></li>`;
      })
      .join('')}</ul>`;
  $('#dueBtn', view)?.addEventListener('click', () => runRound('review', 30, '復習'));
  $('#allWrong', view)?.addEventListener('click', () => runRound('wrong', 20, '間違いノート'));
}

// ---------- 記録: stats ----------

export function viewStats(view, runRound) {
  const st = getState();
  const agg = aggregate(14);
  const all = aggregate(0);
  const today = todayStr();
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(today, -i));
  const maxN = Math.max(10, ...days.map(d => all.day[d]?.n || 0));
  const speed = readingSpeed(14);
  const weak = weakTags(agg, 15);
  const studied = Object.keys(all.day).length;

  const secBar = key => {
    const a = agg.sec[key];
    const r = rate(a);
    return `<div class="secbar">
      <div class="row between"><span>${SECTIONS[key]}</span><span class="small muted">${a ? `${a.c}/${a.n}` : '未解答'}</span></div>
      <div class="bar-track"><i class="${accClass(r)}" style="width:${r == null ? 0 : Math.round(r * 100)}%"></i><span class="target" style="left:70%"></span></div>
      <div class="small"><b>${pct(r)}</b></div>
    </div>`;
  };

  const typeRows = Object.entries(TYPES)
    .map(([t, info]) => {
      const a = all.type[t];
      if (!a) return '';
      return `<tr><td>${info.mondai} ${info.label}</td><td>${a.n}</td><td class="acc ${accClass(rate(a))}">${pct(rate(a))}</td><td class="acc ${accClass(rate(agg.type[t]))}">${pct(rate(agg.type[t]))}</td></tr>`;
    })
    .join('');

  const speedRows = Object.entries(speed)
    .map(([sub, a]) => {
      const cpm = Math.round(a.chars / (a.ms / 60000));
      const vs = a.target ? Math.round((a.ms / a.target) * 100) : null;
      return `<tr><td>${esc(SUBS.reading[sub] || TYPES[sub]?.label || sub)}</td><td>${a.n}</td><td>${cpm}字/分</td><td class="${vs > 110 ? 'ng' : vs != null ? 'ok' : ''}">${vs != null ? vs + '%' : '—'}</td></tr>`;
    })
    .join('');

  view.innerHTML = `
    <h2 class="page-title">記録</h2>
    <section class="stat-row">
      <div class="stat"><b>${diffDays(today, EXAM_DATE)}</b><span>本番まで</span></div>
      <div class="stat"><b>${studied}</b><span>学習日数</span></div>
      <div class="stat"><b>${all.n}</b><span>総解答数</span></div>
    </section>

    <section class="card">
      <div class="card-label">分野別 正答率（直近14日）</div>
      ${['lang', 'read', 'listen'].map(secBar).join('')}
      <p class="small muted">縦線 = 目標70%。合格は総合100/180点＋各分野19点以上。練習では各分野70%を安定して超えることを目標に。</p>
    </section>

    <section class="card">
      <div class="card-label">毎日の解答数（14日）</div>
      <div class="daychart">${days
        .map(d => {
          const a = all.day[d];
          const h = a ? Math.max(4, Math.round((a.n / maxN) * 100)) : 0;
          return `<div class="dc-col" title="${d} ${a ? `${a.n}問 ${pct(rate(a))}` : ''}"><i class="${accClass(rate(a))}" style="height:${h}%"></i><span>${Number(d.slice(8))}</span></div>`;
        })
        .join('')}</div>
    </section>

    ${typeRows ? `<section class="card"><div class="card-label">問題形式別</div><table class="tbl"><thead><tr><th></th><th>回答</th><th>全期間</th><th>14日</th></tr></thead><tbody>${typeRows}</tbody></table></section>` : ''}

    ${
      speedRows
        ? `<section class="card"><div class="card-label">読解スピード（14日）</div><table class="tbl"><thead><tr><th></th><th>文章</th><th>速さ</th><th>目安比</th></tr></thead><tbody>${speedRows}</tbody></table><p class="small muted">目安比100%以下なら本番の時間配分に間に合うペース。</p></section>`
        : ''
    }

    ${
      weak.length
        ? `<section class="card"><div class="card-label">弱点タグ（直近14日）</div><div class="chips">${weak
            .map(w => `<button class="chip" data-tag="${esc(w.tag)}">${esc(w.tag)} <small>${w.c}/${w.n}</small></button>`)
            .join('')}</div><p class="small muted">タップするとその項目だけ練習できます。</p></section>`
        : ''
    }`;
  $$('[data-tag]', view).forEach(b => b.addEventListener('click', () => runRound('tag', b.dataset.tag, b.dataset.tag)));
}

// ---------- 設定 ----------

export function viewSettings(view) {
  const st = getState();
  const s = st.settings;
  const voices = tts.japaneseVoices();
  const voiceOpts = sel => ['<option value="">自動</option>', ...voices.map(v => `<option${v.name === sel ? ' selected' : ''}>${esc(v.name)}</option>`)].join('');

  view.innerHTML = `
    <h2 class="page-title">設定</h2>

    <section class="card form">
      <div class="card-label">学習</div>
      <label class="field"><span>1日の目標</span>
        <select id="daily">${[30, 50, 80].map(n => `<option value="${n}"${s.daily === n ? ' selected' : ''}>${n}問（約${Math.round(n * 1.2)}分）</option>`).join('')}</select>
      </label>
      <label class="switch"><input type="checkbox" id="showEn"${s.showEn ? ' checked' : ''}><span>解説に英語の補足を表示</span></label>
      <label class="switch"><input type="checkbox" id="mincho"${s.mincho ? ' checked' : ''}><span>問題文を明朝体で表示（本番と同じ）</span></label>
      <label class="switch"><input type="checkbox" id="big"${s.big ? ' checked' : ''}><span>文字を大きく</span></label>
    </section>

    <section class="card form">
      <div class="card-label">聴解の音声</div>
      ${tts.supported ? '' : '<p class="ng small">このブラウザは音声読み上げに対応していません。</p>'}
      <label class="switch"><input type="checkbox" id="examMode"${s.examMode ? ' checked' : ''}><span>本番モード（音声は1回だけ）</span></label>
      <label class="field"><span>速さ <b id="rateVal">${s.rate.toFixed(2)}</b></span><input type="range" id="rate" min="0.7" max="1.3" step="0.05" value="${s.rate}"></label>
      <label class="field"><span>女性の声</span><select id="voiceF">${voiceOpts(s.voiceF)}</select></label>
      <label class="field"><span>男性の声</span><select id="voiceM">${voiceOpts(s.voiceM)}</select></label>
      <button class="btn" id="testVoice">テスト再生</button>
      <p class="small muted">${voices.length ? `日本語の声：${voices.length}種類` : '日本語の声が見つかりません。'}iPhoneは「設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 日本語」で高品質の声（Kyoko 拡張・Otoya 拡張）を追加できます。</p>
    </section>

    <section class="card form">
      <div class="card-label">GitHub 同期</div>
      <p class="small">解答の記録をGitHubに送ると、毎朝の新しい問題があなたの間違いに合わせて作られます。</p>
      <label class="field"><span>リポジトリ</span><input id="ghRepo" value="${esc(s.ghRepo)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>トークン</span><input id="ghToken" type="password" value="${esc(s.ghToken)}" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="btn-row">
        <button class="btn" id="ghTest">接続テスト</button>
        <button class="btn primary" id="ghSync">今すぐ同期</button>
        <button class="btn" id="ghRestore">GitHubから復元</button>
      </div>
      <p class="small muted" id="ghStatus">アプリ ${APP_VERSION}・最終同期：${ago(st.sync.last)}・この端末の解答 ${sync.localCount()}問${st.sync.error ? ` ・<span class="ng">${esc(st.sync.error)}</span>` : ''}</p>
      <p class="small muted">※ iPhoneの「ホーム画面のアプリ」とSafariは記録が別々です。問題を解く方にトークンを入れてください。</p>
      <details class="help"><summary>トークンの作り方</summary>
        <ol class="small">
          <li>github.com → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
          <li>Repository access：<b>Only select repositories</b> → <code>n1-daily</code> だけ</li>
          <li>Permissions → Repository permissions → <b>Contents：Read and write</b>（他は不要）</li>
          <li>有効期限は 2026年12月末 くらいに設定 → 生成された <code>github_pat_…</code> をここに貼る</li>
        </ol>
        <p class="small muted">トークンはこの端末のブラウザにだけ保存されます。記録（問題IDと正誤）は公開リポジトリの <code>progress</code> ブランチに保存されます。</p>
      </details>
    </section>

    <section class="card form">
      <div class="card-label">データ</div>
      <div class="btn-row">
        <button class="btn" id="export">バックアップを保存</button>
        <label class="btn">バックアップを読込<input type="file" id="import" accept="application/json" hidden></label>
      </div>
      <button class="btn danger" id="reset">記録をすべて消す</button>
      <p class="small muted">端末ID：${esc(st.deviceId)}・問題数：${DB.list.length}・試験日：${EXAM_DATE}</p>
    </section>`;

  const set = (k, v) => {
    s[k] = v;
    save();
  };
  $('#daily').addEventListener('change', e => set('daily', Number(e.target.value)));
  $('#showEn').addEventListener('change', e => set('showEn', e.target.checked));
  $('#mincho').addEventListener('change', e => set('mincho', e.target.checked));
  $('#big').addEventListener('change', e => {
    set('big', e.target.checked);
    document.body.classList.toggle('big', e.target.checked);
  });
  $('#examMode').addEventListener('change', e => set('examMode', e.target.checked));
  $('#rate').addEventListener('input', e => {
    set('rate', Number(e.target.value));
    $('#rateVal').textContent = Number(e.target.value).toFixed(2);
  });
  $('#voiceF').addEventListener('change', e => set('voiceF', e.target.value));
  $('#voiceM').addEventListener('change', e => set('voiceM', e.target.value));
  $('#testVoice').addEventListener('click', () =>
    tts.speak([
      { who: 'F', text: '来週の会議の資料、もう準備できましたか。' },
      { who: 'M', text: 'ええ、昨日のうちに仕上げておきました。' },
    ]),
  );

  const status = msg => ($('#ghStatus').innerHTML = esc(msg));
  $('#ghRepo').addEventListener('change', e => set('ghRepo', e.target.value.trim()));
  $('#ghToken').addEventListener('change', e => set('ghToken', e.target.value.trim()));
  $('#ghTest').addEventListener('click', async () => {
    set('ghRepo', $('#ghRepo').value.trim());
    set('ghToken', $('#ghToken').value.trim());
    status('確認中…');
    try {
      status(await sync.testConnection());
    } catch (e) {
      status('通信エラー：' + e.message);
    }
  });
  $('#ghSync').addEventListener('click', async () => {
    set('ghToken', $('#ghToken').value.trim());
    status('同期中…');
    const r = await sync.syncNow();
    status(r.msg);
  });
  $('#ghRestore').addEventListener('click', async () => {
    set('ghToken', $('#ghToken').value.trim());
    status('復元中…');
    try {
      const n = await sync.restore();
      status(`${n}件の記録を取り込みました`);
    } catch (e) {
      status(e.message);
    }
  });

  $('#export').addEventListener('click', () => {
    const copy = { ...st, settings: { ...st.settings, ghToken: '' } };
    const blob = new Blob([JSON.stringify(copy)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `n1-daily-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.log)) throw new Error('形式が違います');
      data.settings = { ...st.settings, ...data.settings, ghToken: st.settings.ghToken };
      replaceState({ ...st, ...data });
      toast('読み込みました');
      location.reload();
    } catch (err) {
      toast('読み込めませんでした：' + err.message);
    }
  });
  $('#reset').addEventListener('click', () => {
    if (!confirm('この端末の学習記録をすべて消します。よろしいですか？')) return;
    replaceState({ ...st, log: [], learned: {}, plans: {}, sync: { shas: {}, counts: {}, last: 0, error: '' } });
    toast('消去しました');
    location.hash = '#/';
  });
}
