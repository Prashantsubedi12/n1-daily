export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Light markup used in question data:
//   __text__  underline (the word being asked about)
//   **text**  bold
//   ＿★＿     the starred blank in 文の組み立て,  ＿＿  a plain blank
export function fmt(s = '') {
  return esc(s)
    .replace(/＿★＿/g, '<span class="blank star">★</span>')
    .replace(/＿＿/g, '<span class="blank"></span>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

export function paras(s = '') {
  return s.split(/\n+/).filter(p => p.trim()).map(p => `<p>${fmt(p)}</p>`).join('');
}

export function plain(s = '') {
  return String(s).replace(/__|\*\*/g, '').replace(/＿★＿/g, '★').replace(/\n/g, ' ');
}

export function mmss(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pct(rate) {
  return rate == null ? '—' : Math.round(rate * 100) + '%';
}

let toastTimer = null;
export function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function ago(ts) {
  if (!ts) return '未同期';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.round(h / 24)}日前`;
}
