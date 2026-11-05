#!/usr/bin/env node
// Drives the real app in headless Chrome like a learner on a phone, and fails on any JS error.
// The improver agent must pass this before and after every deploy.
//
// Usage:
//   node tools/smoke.mjs                         # serves this folder locally and tests it
//   node tools/smoke.mjs --url https://prashantsubedi12.github.io/n1-daily/   # tests the live site
//
// Uses an isolated browser profile and synthetic study activity.

import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const problems = [];
const steps = [];
const step = (name, fn) => async () => {
  try {
    await fn();
    steps.push('✓ ' + name);
  } catch (e) {
    problems.push(`${name}: ${e.message.split('\n')[0]}`);
    steps.push('✗ ' + name);
  }
};

const server = urlArg ? null : await serve();
const base = urlArg || `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(join(tmpdir(), 'n1smoke-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ['--no-first-run'] });
const page = await browser.newPage();
const mobileViewport = width => page.setViewport({
  width, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
});
await mobileViewport(390);

const origin = new URL(base).origin;
let testingOffline = false;
page.on('pageerror', e => problems.push(`page error: ${e.message}`));
page.on('dialog', async dialog => {
  if (dialog.type() === 'confirm' && dialog.message().startsWith('途中のラウンドがあります。')) return dialog.accept();
  problems.push(`unexpected dialog: ${dialog.message()}`);
  await dialog.dismiss();
});
page.on('console', m => {
  if (testingOffline && m.text().includes('503') && m.location().url?.includes('/data/daily/')) return;
  if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
});
page.on('response', r => {
  if (testingOffline && r.status() === 503 && new URL(r.url()).pathname.includes('/data/daily/')) return;
  if (r.url().startsWith(origin) && r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url().replace(origin, '')}`);
});

// Scroll to the middle first like a person would — elements near the bottom sit under the fixed tab bar.
async function tap(sel) {
  const el = await page.waitForSelector(sel);
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await el.click();
}

const go = async hash => {
  await page.evaluate(h => (location.hash = h), hash);
  await page.waitForFunction(() => document.querySelector('#view')?.children.length > 0);
};
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('n1daily.v1') || '{}'));

async function checkPalette(scheme, expected) {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  const palette = await page.evaluate(keys => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(keys.map(key => [key, css.getPropertyValue(key).trim().toLowerCase()]));
  }, Object.keys(expected));
  assert.deepEqual(palette, expected, `${scheme} theme tokens`);
}

async function checkRouteLayout(width, tab, { home = false, study = false } = {}) {
  const layout = await page.evaluate(({ home }) => {
    const root = document.documentElement;
    const body = getComputedStyle(document.body);
    const heading = document.querySelector(home ? 'main h1' : 'main .page-title');
    const primary = document.querySelector('#priorityStart');
    const nav = document.querySelector('#tabbar');
    const primaryBox = primary?.getBoundingClientRect();
    return {
      width: Math.max(root.scrollWidth, document.body.scrollWidth),
      font: body.fontFamily,
      fontSize: Number.parseFloat(body.fontSize),
      leading: Number.parseFloat(body.lineHeight),
      title: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : 0,
      active: [...nav.querySelectorAll('[aria-current="page"]')].map(el => el.dataset.tab),
      navHidden: getComputedStyle(nav).display === 'none',
      visibleAction: primaryBox && primaryBox.height >= 44 && primaryBox.bottom <= nav.getBoundingClientRect().top,
    };
  }, { home });
  // Compare to the configured width because mobile Chrome may expand innerWidth on overflow.
  assert.ok(layout.width <= width + 1, `content is ${layout.width}px wide at ${width}px`);
  assert.match(layout.font, /Hiragino|Noto Sans JP|Yu Gothic|Meiryo/i, 'Japanese font stack');
  assert.ok(layout.fontSize >= 16 && layout.leading >= layout.fontSize * 1.5, 'mobile body typography');
  if (!study) assert.ok(layout.title >= 20, 'page title is visually distinct');
  assert.equal(layout.navHidden, study, 'bottom navigation visibility');
  assert.deepEqual(layout.active, tab ? [tab] : [], 'current tab');
  if (home) assert.ok(layout.visibleAction, '44px priority action above the bottom navigation');
}

async function checkNarrowStudyLayout() {
  try {
    await mobileViewport(320);
    await checkRouteLayout(320, null, { study: true });
  } finally {
    await mobileViewport(390);
  }
}

// Picks an answer: first choice, or for 文の組み立て taps every piece into the blanks.
async function pickAnswer() {
  if (await page.$('.choice:not([disabled])')) return tap('.choice:not([disabled])');
  while (await page.$('.tile:not([disabled])')) await tap('.tile:not([disabled])');
  await tap('[data-act="submit-order"]:not([disabled])');
}

// Answers the current question, opens the explanation, moves on. Returns false when the round is over.
async function answerOne() {
  const has = await page.$('.choice:not([disabled]), .tile:not([disabled])');
  if (!has) return false;
  await pickAnswer();
  await page.waitForSelector('.fb');
  await tap('[data-act="next"]');
  await page.waitForFunction(() => document.querySelector('.choice:not([disabled]), .tile:not([disabled])') || document.querySelector('.summary'));
  return true;
}

async function startMenu(key) {
  await go('#/');
  await page.waitForSelector(`[data-menu="${key}"]`);
  await tap(`[data-menu="${key}"]`);
  await page.waitForSelector('.choice, .tile', { timeout: 5000 });
}

async function exitRound() {
  await tap('[data-act="exit"]');
  await page.waitForSelector('.menu');
}

const flow = [
  step('home shows the coach, reading mission and all study shortcuts on mobile', async () => {
    await page.goto(base + '#/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.menu-item');
    await page.waitForSelector('.coach');
    await page.waitForSelector('.buddy .momo');
    await page.waitForSelector('.buddy .ring');
    await page.waitForSelector('.quests .quest-list li');
    await page.waitForSelector('.buddy .lvl');
    assert.deepEqual(await page.$$eval('#tabbar a', links => links.map(a => a.textContent.trim())),
      ['ホーム', '新出', '練習', '復習', '記録']);
    assert.deepEqual(await page.$$eval('.menu [data-menu]', buttons => buttons.map(button => button.dataset.menu)),
      ['review', 'lang', 'read', 'listen']);
    await checkPalette('light', { '--bg': '#faf6ed', '--card': '#fffdf8', '--pri': '#244ca6' });
    try {
      for (const width of [320, 390, 430]) {
        await mobileViewport(width);
        await checkRouteLayout(width, 'home', { home: true });
      }
      await mobileViewport(390);
      await checkPalette('dark', { '--bg': '#191714' });
      await checkRouteLayout(390, 'home', { home: true });
    } finally {
      await mobileViewport(390);
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    }
  }),
  step('priority drill: reveal evidence, reload feedback, then complete once', async () => {
    await tap('#priorityStart');
    await page.waitForSelector('.passage');
    await checkNarrowStudyLayout();
    const order = await page.$$eval('.choice', buttons => buttons.map(b => b.dataset.i));
    await pickAnswer();
    await tap('.reading-evidence summary');
    await page.waitForSelector('.reading-evidence[open] blockquote');
    await page.waitForSelector('.reading-distractor');
    const answered = await state();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fb');
    const restoredOrder = await page.$$eval('.choice', buttons => buttons.map(b => b.dataset.i));
    if (restoredOrder.join() !== order.join() || (await state()).log.length !== answered.log.length) throw new Error('reload lost quiz state');
    await tap('[data-act="next"]');
    await page.waitForSelector('.summary');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.summary');
    if ((await state()).events.filter(e => e.k === 'end' && e.m === 'priority').length !== 1) throw new Error('priority completion was not recorded exactly once');
    await tap('[data-act="home"]');
    await page.waitForFunction(() => document.querySelector('.priority')?.textContent.includes('クリアしました'));
  }),
  step('語彙・文法: answer, report a question, leave mid-round', async () => {
    await startMenu('lang');
    await pickAnswer();
    await page.waitForSelector('.fb .momo');
    await page.waitForSelector('[data-act="report"]');
    await tap('[data-act="report"]');
    await page.waitForSelector('[data-reason]');
    await tap('[data-reason]');
    await tap('[data-act="next"]');
    await page.waitForSelector('.choice:not([disabled]), .tile:not([disabled])');
    await answerOne();
    await exitRound();
    const st = await state();
    if (st.feedback?.length !== 1 || !st.feedback[0].id) throw new Error('question report was not saved');
    if (!st.activeQuiz || st.events.some(e => e.k === 'end' && e.m === 'lang')) throw new Error('suspended round was not retained');
  }),
  step('語彙・文法: resume and finish to the result screen', async () => {
    await startMenu('lang');
    for (let i = 0; i < 80 && (await answerOne()); i++);
    await page.waitForSelector('.summary');
    await page.waitForSelector('.sum-hero .momo');
    await page.waitForSelector('.summary .quest-list');
    await page.waitForFunction(() => Number(document.querySelector('#xpCount')?.textContent.replace('+', '')) > 0);
    await tap('[data-act="home"]');
    await page.waitForSelector('.menu');
    const st = await state();
    if (!st.events?.some(e => e.k === 'end' && e.fin === 1 && e.m === 'lang')) throw new Error('finished round not logged');
  }),
  step('読解: passage round renders and answers', async () => {
    await startMenu('read');
    await page.waitForSelector('.passage');
    await answerOne();
    await exitRound();
  }),
  step('聴解: listening round renders and answers', async () => {
    await startMenu('listen');
    await page.evaluate(() => { speechSynthesis.getVoices = () => []; });
    await tap('[data-act="play"]');
    await tap('[data-act="transcript"]');
    await page.waitForSelector('.listen .script[open]');
    await answerOne();
    if (!(await state()).log.at(-1)?.assisted) throw new Error('transcript answer was not marked as assisted');
    await exitRound();
  }),
  step('文の組み立て: pieces fill the blanks and ★ is graded', async () => {
    await page.evaluate(() => (location.hash = '#/practice'));
    await tap('[data-type="order"]');
    await page.waitForSelector('.tile');
    while (await page.$('.tile:not([disabled])')) await tap('.tile:not([disabled])');
    const submit = '[data-act="submit-order"]:not([disabled])';
    await page.waitForSelector(submit);
    if (await page.$('.fb')) throw new Error('order was graded before confirmation');
    await tap('.slot[data-s="0"]');
    if (await page.$(submit)) throw new Error('undo did not empty the slot');
    await tap('.tile:not([disabled])');
    await tap(submit);
    await page.waitForSelector('.slot.star.correct, .slot.star.wrong');
    await page.waitForSelector('.fb');
    await exitRound();
  }),
  step('漢字マッチ: clear both boards', async () => {
    await go('#/match');
    await page.waitForSelector('.match-head');
    await checkNarrowStudyLayout();
    for (let i = 0; i < 20 && !(await page.$('.match-done')); i++) {
      const k = await page.$eval('.mtile.w:not([disabled])', b => b.dataset.k).catch(() => null);
      if (!k) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      await tap(`.mtile.w[data-k="${k}"]`);
      await tap(`.mtile.r[data-k="${k}"]`);
    }
    await page.waitForSelector('.match-done', { timeout: 5000 });
    const st = await state();
    if (!st.events?.some(e => e.k === 'match' && e.fin === 1)) throw new Error('match not logged');
  }),
  step('今日の新出: cards render, 覚えた saves', async () => {
    await go('#/learn');
    const box = await page.$('[data-learn]');
    if (box) {
      await page.evaluate(el => el.closest('details').setAttribute('open', ''), box);
      await tap('[data-learn]');
      const st = await state();
      if (!Object.keys(st.learned || {}).length) throw new Error('覚えた not saved');
    }
  }),
  step('記録: level and badges render', async () => {
    await go('#/stats');
    await page.waitForSelector('.badges .badge.got');
  }),
  ...[
    ['learn', /新出/, true],
    ['practice', /^分野別練習$/, true],
    ['review', /^復習$/, true],
    ['stats', /^記録$/, true],
    ['settings', /^設定$/, false],
    ['feedback', /^意見・更新$/, false],
  ].map(([route, title, isTab]) =>
    step(`#/${route} uses the shared mobile theme and tab state`, async () => {
      try {
        await go('#/' + route);
        await page.waitForFunction((pattern, tab) =>
          new RegExp(pattern).test(document.querySelector('.page-title')?.textContent.trim() || '') &&
          (document.querySelector('[aria-current="page"]')?.dataset.tab || '') === tab,
        {}, title.source, isTab ? route : '');
        for (const width of [320, 390, 430]) {
          await mobileViewport(width);
          await checkRouteLayout(width, isTab ? route : null);
        }
        await checkPalette('dark', { '--bg': '#191714' });
        await checkRouteLayout(430, isTab ? route : null);
      } finally {
        await mobileViewport(390);
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      }
    }),
  ),
  step('意見・更新: save feedback on this device', async () => {
    await go('#/feedback');
    await page.type('#fbText', 'smoke test');
    await tap('#fbSend');
    await page.waitForFunction(() => document.querySelector('#fbStatus').textContent.includes('保存しました'));
  }),
  step('home shows today’s answers after studying', async () => {
    await go('#/');
    await page.waitForSelector('.coach');
    const st = await state();
    if (!(st.log?.length >= 3)) throw new Error(`only ${st.log?.length || 0} answers recorded`);
    if (!st.events?.some(e => e.k === 'open')) throw new Error('app open not logged');
  }),
  ...(!urlArg ? [step('offline: reload an installed shell with playable bank content', async () => {
    await page.waitForFunction(() => document.querySelector('#offlineReady')?.textContent.includes('オフライン'), { timeout: 20000 });
    testingOffline = true;
    await page.setOfflineMode(true);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.menu');
      await startMenu('read');
      await page.waitForSelector('.passage');
      await exitRound();
    } finally {
      await page.setOfflineMode(false);
      testingOffline = false;
    }
  })] : []),
];

for (const s of flow) await s();

await browser.close();
await rm(profile, { recursive: true, force: true });
server?.close();

console.log(steps.join('\n'));
if (problems.length) {
  console.log(`\nSMOKE FAILED (${base})\n- ` + [...new Set(problems)].join('\n- '));
  process.exit(1);
}
console.log(`\nSMOKE OK (${base})`);
