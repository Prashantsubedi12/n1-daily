import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from '../js/store.js';

globalThis.localStorage = { getItem: () => null, setItem() {} };
load();

const japanese = { lang: 'ja-JP', name: 'Kyoko' };
let voices = [];
let queued = [];
const speech = {
  getVoices: () => voices,
  speak: utterance => queued.push(utterance),
  cancel() {},
};
globalThis.window = { speechSynthesis: speech };
globalThis.speechSynthesis = speech;
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};

const { speak, stop } = await import('../js/speech.js');
const script = [{ who: 'N', text: '一文目。二文目。' }];

test('a missing Japanese voice leaves the request available to retry', () => {
  assert.equal(speak(script), false);
  voices = [japanese];
  assert.equal(speak(script), true);
  assert.equal(queued.length, 2);
  stop();
  queued = [];
});

test('audio start and completion fire once for a multi-part script', () => {
  const events = [];
  speak(script, { onStart: () => events.push('start'), onEnd: () => events.push('end') });
  queued[0].onstart();
  queued[0].onend();
  queued[1].onstart();
  queued[1].onend();
  queued[1].onend();
  assert.deepEqual(events, ['start', 'end']);
  queued = [];
});

test('a playback error is surfaced and late callbacks from cancelled speech are ignored', () => {
  const events = [];
  speak(script, { onError: reason => events.push(reason), onEnd: () => events.push('old-end') });
  const old = queued;
  stop();
  queued = [];
  speak(script, { onError: reason => events.push(reason), onEnd: () => events.push('end') });
  old[1].onerror({ error: 'interrupted' });
  old[1].onend();
  queued[0].onstart();
  queued[0].onerror({ error: 'voice-unavailable' });
  queued[1].onend();
  assert.deepEqual(events, ['voice-unavailable']);
  queued = [];
});
