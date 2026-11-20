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

// Line icons: one 24px grid, 1.75 stroke, round caps and joins (same rules as the tab bar).
const ICONS = {
  review: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8.5V12l2.5 2"/>',
  layers: '<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4"/><path d="m4 16 8 4 8-4"/>',
  book: '<path d="M12 7v13"/><path d="M12 7c-2-2-5-2.5-8-2v13c3-.5 6 0 8 2 2-2 5-2.5 8-2V5c-3-.5-6 0-8 2z"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="4" y="14" width="4" height="6" rx="1.5"/><rect x="16" y="14" width="4" height="6" rx="1.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/>',
  speaker: '<path d="M4 9.5h3l5-4v13l-5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
};

export const icon = (name, size = 20) =>
  `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
