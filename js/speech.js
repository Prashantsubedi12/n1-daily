// Text-to-speech for 聴解 using the device's Japanese voices (iOS: Kyoko/Otoya, Android: Google 日本語).

import { getState } from './store.js';

export const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

const FEMALE = /kyoko|o-?ren|nanami|haruka|ayumi|mizuki|sayaka|google/i;
const MALE = /otoya|hattori|ichiro|keita|daichi|naoki|male|男/i;
// macOS ships robotic "fun" voices for every language; never pick them automatically.
const NOVELTY = /eddy|flo\b|grandma|grandpa|reed|rocko|sandy|shelley|albert|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy/i;
const QUALITY = /enhanced|premium|拡張|プレミアム|natural|neural|online/i;
let voices = [];

function best(list) {
  return list.find(v => QUALITY.test(v.name)) || list[0] || null;
}

function refresh() {
  if (!supported) return;
  voices = speechSynthesis.getVoices().filter(v => /^ja([-_]|$)/i.test(v.lang));
}
if (supported) {
  refresh();
  speechSynthesis.addEventListener?.('voiceschanged', refresh);
}

export function japaneseVoices() {
  refresh();
  return [...voices].sort((a, b) => NOVELTY.test(a.name) - NOVELTY.test(b.name));
}

function cast() {
  const { voiceF, voiceM } = getState().settings;
  const byName = n => voices.find(v => v.name === n);
  const usable = voices.filter(v => !NOVELTY.test(v.name));
  const female = byName(voiceF) || best(usable.filter(v => FEMALE.test(v.name))) || best(usable.filter(v => !MALE.test(v.name))) || voices[0] || null;
  const male = byName(voiceM) || best(usable.filter(v => MALE.test(v.name) && v !== female));
  return {
    F: { voice: female, pitch: 1.05 },
    // With only one voice installed, a lower pitch keeps the two speakers distinguishable.
    M: male ? { voice: male, pitch: 1 } : { voice: female, pitch: 0.7 },
    N: { voice: female, pitch: 1 },
  };
}

// Chrome cuts utterances off after ~15s, so speak sentence by sentence.
function chunks(text) {
  return text.split(/(?<=[。！？!?])/).map(s => s.trim()).filter(Boolean);
}

// parts: [{who: 'F'|'M'|'N', text}]
export function speak(parts, onEnd) {
  if (!supported) return false;
  refresh();
  speechSynthesis.cancel();
  const roles = cast();
  const rate = getState().settings.rate || 1;
  const utts = [];
  for (const p of parts) {
    const role = roles[p.who] || roles.N;
    for (const c of chunks(p.text)) {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = 'ja-JP';
      if (role.voice) u.voice = role.voice;
      u.pitch = role.pitch;
      u.rate = p.who === 'N' ? rate * 0.95 : rate;
      utts.push(u);
    }
  }
  if (!utts.length) return false;
  utts[utts.length - 1].onend = () => onEnd && onEnd();
  utts.forEach(u => speechSynthesis.speak(u));
  return true;
}

export function stop() {
  if (supported) speechSynthesis.cancel();
}

// Builds the spoken sequence for a listening question, in test order.
export function partsFor(q, order) {
  const parts = [];
  const other = s => (s === 'M' ? 'F' : 'M');
  if (q.sub === 'response') {
    for (const l of q.script) parts.push({ who: l.s, text: l.t });
    const responder = other(q.script[q.script.length - 1].s);
    order.forEach((orig, i) => {
      parts.push({ who: 'N', text: `${i + 1}。` });
      parts.push({ who: responder, text: q.choices[orig] });
    });
    return parts;
  }
  if (q.intro) parts.push({ who: 'N', text: q.intro });
  for (const l of q.script) parts.push({ who: l.s, text: l.t });
  if (q.ask) parts.push({ who: 'N', text: q.ask });
  if (!q.printed) {
    order.forEach((orig, i) => {
      parts.push({ who: 'N', text: `${i + 1}。${q.choices[orig]}` });
    });
  }
  return parts;
}
