#!/usr/bin/env node
// Drives the real app in headless Chrome like a learner on a phone, and fails on any JS error.
// The improver agent must pass this before and after every deploy.
//
// Usage:
//   node tools/smoke.mjs                         # serves this folder locally and tests it
//   node tools/smoke.mjs --url https://prashantsubedi12.github.io/n1-daily/   # tests the live site
//
// Uses a fresh browser profile with no GitHub token, so it never writes to the progress branch.

import { createServer } from 'node:http';
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
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
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
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const origin = new URL(base).origin;
page.on('pageerror', e => problems.push(`page error: ${e.message}`));
page.on('console', m => {
  if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
});
page.on('response', r => {
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

// Answers the current question (first choice), opens the explanation, moves on. Returns false when the round is over.
async function answerOne() {
  const has = await page.$('.choice:not([disabled])');
  if (!has) return false;
  await tap('.choice:not([disabled])');
  await page.waitForSelector('.fb');
  await tap('[data-act="next"]');
  await page.waitForFunction(() => document.querySelector('.choice:not([disabled])') || document.querySelector('.summary'));
  return true;
}

async function startMenu(key) {
  await go('#/');
  await page.waitForSelector(`[data-menu="${key}"]`);
  await tap(`[data-menu="${key}"]`);
  await page.waitForSelector('.choice', { timeout: 5000 });
}

async function exitRound() {
  await tap('[data-act="exit"]');
  await page.waitForSelector('.menu');
}

const flow = [
  step('home loads with menu and score card', async () => {
    await page.goto(base + '#/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.menu-item');
    await page.waitForSelector('.coach');
  }),
  step('語彙・文法: answer, report a question, leave mid-round', async () => {
    await startMenu('lang');
    await tap('.choice');
    await page.waitForSelector('[data-act="report"]');
    await tap('[data-act="report"]');
    await page.waitForSelector('[data-reason]');
    await tap('[data-reason]');
    await tap('[data-act="next"]');
    await page.waitForSelector('.choice:not([disabled])');
    await answerOne();
    await exitRound();
    const st = await state();
    if (st.feedback?.length !== 1 || !st.feedback[0].id) throw new Error('question report was not saved');
    if (!st.events?.some(e => e.k === 'end' && e.fin === 0)) throw new Error('abandoned round not logged');
  }),
  step('語彙・文法: resume and finish to the result screen', async () => {
    await startMenu('lang');
    for (let i = 0; i < 80 && (await answerOne()); i++);
    await page.waitForSelector('.summary');
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
    await answerOne();
    await exitRound();
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
  ...['practice', 'review', 'stats', 'settings'].map(r =>
    step(`#/${r} renders`, async () => {
      await go('#/' + r);
      await page.waitForSelector('.page-title');
    }),
  ),
  step('意見・更新: send feedback without a token', async () => {
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
