// モモ先生: a momo-dumpling coach in an exam headband who reacts to answers, cheers on streaks and
// greets on ホーム, plus the goal ring and confetti. Presentation only — nothing here is stored or synced.

const NAME = 'プラシャント';
const COLORS = ['#e2483d', '#f5b829', '#52c58d', '#78a8ff', '#f4a3a0'];
const INK = '#5a3d24';

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const line = d => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

const FACES = {
  calm: `<circle cx="25" cy="38" r="2.4" fill="${INK}"/><circle cx="39" cy="38" r="2.4" fill="${INK}"/>${line('M29 44q3 3 6 0')}`,
  happy: `${line('M22 38.5q3-4 6 0M36 38.5q3-4 6 0')}<path d="M27.5 43h9q-1 6-4.5 6t-4.5-6z" fill="${INK}"/><path d="M29.6 47.3q2.4 1.4 4.8 0" fill="none" stroke="#f08c86" stroke-width="1.6" stroke-linecap="round"/>`,
  wow: `<circle cx="25" cy="37.5" r="3.4" fill="${INK}"/><circle cx="39" cy="37.5" r="3.4" fill="${INK}"/><circle cx="26.2" cy="36.3" r="1.2" fill="#fff"/><circle cx="40.2" cy="36.3" r="1.2" fill="#fff"/><ellipse cx="32" cy="45.5" rx="2.6" ry="3" fill="${INK}"/>
    <path d="M7 14l1.3 3.2 3.2 1.3-3.2 1.3L7 23l-1.3-3.2-3.2-1.3 3.2-1.3zM57 8l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="#f5b829"/>`,
  oops: `${line('M21.5 33.8l6 1.4M42.5 33.8l-6 1.4')}<circle cx="25" cy="38.5" r="2.2" fill="${INK}"/><circle cx="39" cy="38.5" r="2.2" fill="${INK}"/>${line('M28 46q2-2 4 0t4 0')}<path d="M51.5 37q2.6 4 0 5.6q-2.6-1.6 0-5.6z" fill="#7cc4f2"/>`,
};

// mood: calm | happy | wow | oops. cls adds a size (sm | md | lg) and optionally "float".
export function mascot(mood = 'calm', cls = 'sm') {
  return `<svg class="momo ${mood} ${cls}" viewBox="0 0 64 64" role="img" aria-label="モモ先生">
    <ellipse cx="32" cy="59" rx="19" ry="3" fill="#000" opacity=".12"/>
    <path d="M7 47c0-17 11-31 25-31s25 14 25 31c0 6-9 9-25 9S7 53 7 47z" fill="#fbf1de" stroke="#d9bf94" stroke-width="1.5"/>
    <path d="M32 17c-5 4-9 9-11 15M32 17c5 4 9 9 11 15M32 17c-1.5 4-2.5 8-3 12M32 17c1.5 4 2.5 8 3 12" fill="none" stroke="#e2c99f" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M28 17.5q4-7 8 0q-4 2-8 0z" fill="#f3e2c2" stroke="#d9bf94" stroke-width="1.2"/>
    <path d="M10.4 32q21.6-7 43.2 0l-.8 4.2q-20.8-6.6-41.6 0z" fill="#e2483d"/>
    <path d="M52.5 33l7-3.2-1.4 5.2zM52.6 34.4l6 4.2-5.6.8z" fill="#c9372d"/>
    <text x="32" y="32.6" text-anchor="middle" font-size="4.6" font-weight="800" fill="#fff" font-family="-apple-system, sans-serif">N1</text>
    <ellipse cx="18.5" cy="43.5" rx="3.4" ry="2.2" fill="#f4a3a0" opacity=".75"/>
    <ellipse cx="45.5" cy="43.5" rx="3.4" ry="2.2" fill="#f4a3a0" opacity=".75"/>
    ${FACES[mood] || FACES.calm}
  </svg>`;
}

const LINES = {
  ok: ['いいね！', 'その調子！', 'ナイス！', '正解！よく覚えてるね', 'バッチリ！', 'さすが！'],
  combo: n => [`${n}連続正解！ノッてきたね🔥`, `${n}連続！止まらないね`, `${n}問連続！本番もこの感じで`],
  bigCombo: n => [`${n}連続😳 すごすぎる！`, `${n}連続！今日の${NAME}は強い`, `${n}連続🔥 もう誰にも止められない`],
  slow: ['正解！あとは少しスピードを上げよう⏱', '正解。本番は時間との勝負、次はもっと速く'],
  retryOk: ['今度はバッチリ！もう忘れないね', '2回目で取れた。これで覚えたね✨'],
  ng: ['おしい！ここはよく狙われるところ', 'ドンマイ。解説を読めば次は取れる', 'ひっかけだったね。理由を見てみよう👇', '大丈夫、今間違えておけば本番では間違えない'],
  lost: n => `${n}連続でストップ！でもいい流れだったよ`,
  same: '前回も同じ選択肢を選んでたよ⚠️ ここは要注意！',
  run: ['ひと息ついて。1問ずつでいいよ', '難しいのが続くね。焦らずいこう'],
  soon: '最後にもう一回出すから、ここで覚えちゃおう',
};

// What モモ先生 says right after an answer.
export function reaction({ ok, rt, combo, lostCombo, wrongRun, slow, same, retrySoon }) {
  if (ok) {
    if (combo >= 5) return { mood: 'wow', text: pick(LINES.bigCombo(combo)) };
    if (rt) return { mood: 'happy', text: pick(LINES.retryOk) };
    if (combo >= 3) return { mood: 'happy', text: pick(LINES.combo(combo)) };
    if (slow) return { mood: 'calm', text: pick(LINES.slow) };
    return { mood: 'happy', text: pick(LINES.ok) };
  }
  if (same) return { mood: 'oops', text: LINES.same };
  if (lostCombo >= 3) return { mood: 'oops', text: LINES.lost(lostCombo) };
  if (wrongRun >= 3) return { mood: 'oops', text: pick(LINES.run) };
  if (retrySoon && Math.random() < 0.4) return { mood: 'oops', text: LINES.soon };
  return { mood: 'oops', text: pick(LINES.ng) };
}

export function summaryLine(rate) {
  if (rate >= 90) return { mood: 'wow', text: pick(['ほぼ完璧！🎉 合格する人の解き方だよ', '素晴らしい！このレベルを毎日キープしよう']) };
  if (rate >= 70) return { mood: 'happy', text: pick(['いい結果！合格ラインのペースだよ', 'よくできました！自信持っていいよ']) };
  if (rate >= 50) return { mood: 'calm', text: pick(['あと一歩！間違えた問題を解き直せば伸びるよ', '悪くない。見直しで点に変えよう']) };
  return { mood: 'oops', text: pick(['今日は手強かったね。でも解いた分だけ強くなる💪', '大丈夫。間違えた問題こそ伸びしろだよ']) };
}

// The home-screen greeting: time of day, then the one thing to do next.
export function greeting({ hour, todays, goal, due, streak }) {
  const hi = hour < 5 ? 'まだ起きてる？' : hour < 11 ? pick(['おはよう！', 'ナマステ🙏']) : hour < 18 ? pick(['こんにちは！', 'ナマステ🙏']) : 'おつかれさま！';
  if (todays >= goal) return { mood: 'wow', text: `${hi} 今日の目標${goal}問クリア🎉 えらい！` };
  if (todays > 0) return { mood: 'happy', text: `${hi} 今日は${todays}問。あと${goal - todays}問で目標達成、いけるよ💪` };
  const start = due ? `復習が${due}問待ってるよ` : 'まずは語彙・文法から';
  if (streak) return { mood: 'calm', text: `${hi} 🔥${streak}日連続中！今日もつなげよう。${start}` };
  return { mood: 'calm', text: `${hi} 今日はまだ0問。${start}。電車の時間でサクッといこう🚃` };
}

// Progress ring (0..1 of max); the number goes in an overlay next to it.
export function ring(value, max) {
  const p = Math.min(1, max ? value / max : 0);
  const c = 2 * Math.PI * 26;
  return `<svg class="ring${p >= 1 ? ' full' : p ? '' : ' empty'}" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="26" class="ring-bg"/>
    <circle cx="32" cy="32" r="26" class="ring-fg" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
  </svg>`;
}

// A short burst of dots from an element (correct answer, 覚えた).
export function sparkle(el) {
  if (!el || still()) return;
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'sparks';
  box.style.left = `${r.left + r.width / 2}px`;
  box.style.top = `${r.top + r.height / 2}px`;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const s = document.createElement('i');
    s.style.cssText = `--x:${Math.round(Math.cos(a) * (40 + Math.random() * 24))}px;--y:${Math.round(Math.sin(a) * (26 + Math.random() * 16))}px;background:${COLORS[i % COLORS.length]}`;
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 800);
}

export function confetti(n = 36) {
  if (still()) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.style.cssText = `left:${Math.random() * 100}%;background:${COLORS[i % COLORS.length]};--dx:${Math.round((Math.random() - 0.5) * 140)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;animation-delay:${(Math.random() * 0.3).toFixed(2)}s;animation-duration:${(1.5 + Math.random() * 0.9).toFixed(2)}s`;
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3000);
}
