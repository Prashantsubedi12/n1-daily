#!/usr/bin/env node
// Exit 1 if a particular JST day's pack is missing or unavailable.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentDateJst, isContentDate } from '../js/data.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));

export function targetDate(args, now = new Date()) {
  const today = contentDateJst(now);
  if (!args.length) return today;
  if (args.length === 1 && args[0] === '--next') {
    const next = new Date(today + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  }
  if (args.length === 2 && args[0] === '--date' && isContentDate(args[1])) return args[1];
  throw new Error('Usage: node tools/freshness.mjs [--print-date] [--next | --date YYYY-MM-DD]');
}

export function checkDailyFreshness(date, read) {
  let index;
  try {
    index = read('index.json');
    if (!Array.isArray(index?.daily) || !index.daily.every(isContentDate)) throw new Error();
  } catch {
    return { ok: false, reason: 'index unavailable or invalid', latest: null };
  }
  const latest = index.daily.filter(d => d <= date).sort().at(-1) || null;
  if (!index.daily.includes(date)) return { ok: false, reason: 'date not indexed', latest };
  try {
    const pack = read(`daily/${date}.json`);
    if (pack?.date !== date || !Array.isArray(pack.questions) || !pack.questions.length) throw new Error();
  } catch {
    return { ok: false, reason: 'indexed pack unavailable or invalid', latest };
  }
  return { ok: true, latest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const printDate = args[0] === '--print-date';
    const date = targetDate(printDate ? args.slice(1) : args);
    if (printDate) {
      console.log(date);
    } else {
      const result = checkDailyFreshness(date, path => JSON.parse(readFileSync(join(DATA, path), 'utf8')));
      if (result.ok) console.log(`FRESH ${date} JST`);
      else {
        console.error(`STALE ${date} JST — ${result.reason}; latest indexed: ${result.latest || 'none'}`);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
