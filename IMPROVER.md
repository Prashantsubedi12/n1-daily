# Improver agent — instructions for the nightly scheduled Claude run (~23:40 JST)

Mission: get Prashant from 81 → 100+/180 on JLPT N1 on **2026-12-06** by making the *app* better at
teaching him, based on how he actually uses it. The question generator (ROUTINE.md) handles daily
content; you handle the app itself, and the generator's instructions when the data says the content
strategy is wrong.

## 0. Gate — do nothing unless he studied

```
git pull --rebase origin main && git fetch origin progress
node tools/analyze.mjs --gate tools/.improver-state.json
```

If `active` is `false`: stop. No edits, no commits. Report "no new study since <since> — nothing to do".
He asked for exactly this: if he does nothing, the app does not change.

## 1. Understand the week

Run `node tools/analyze.mjs` and read all of it, plus `data/changelog.json` (what was already changed)
and the History section below. Priority order for what to work on:

1. **His feedback notes** (`Feedback notes from the learner`) — he asked for it; do it unless it would hurt
   learning, in which case do the closest helpful thing and say why in the changelog.
2. **Bugs** — anything the smoke test or the data shows is broken (e.g. rounds always quit at the same
   question, listening never played, an app version that stopped syncing).
3. **Friction in the data** — rounds started but quit early (`quit` with few answered), a menu he never
   opens, opened-but-not-studied days, very long minutes on one question type.
4. **Learning effectiveness** — the estimate shows a section below 19 or far below the others; traps,
   forgotten items, slow-but-correct items, listening accuracy that depends on replays. Pick features
   from the backlog that attack the biggest gap.

Reported questions (`Reported questions`) are NOT yours — the nightly generator fixes them.

## 2. Change at most 2 things, small

- Each change ≤ ~150 changed lines, one clear purpose, Japanese UI text, mobile first (390px wide).
- Match the existing code style (vanilla ES modules, no build step, CSS variables in css/app.css, dark mode).
- Never: add a runtime dependency or CDN; rename, move or remove the bottom tabs or the 今日のメニュー
  items (he studies on a train — the layout must stay familiar); change the meaning of stored fields
  (`log`, `events`, `feedback`, `learned`, `plans`, `settings`) — adding new optional fields is fine;
  touch the token handling except to fix a bug; touch the `progress` branch; delete his data.
- You may also edit ROUTINE.md (the generator's content strategy) when the data says the mix is wrong —
  e.g. more 読解 when 読解 is the lowest section. That counts as one of your 2 changes.
- If nothing is clearly worth changing, change nothing — then skip to step 5 and mark.

## 3. Verify before shipping

0. If `node_modules/` is missing, run `npm install` first (tools only — the app has no dependencies).
1. Bump `VERSION` in sw.js and `APP_VERSION` in js/store.js to the next number (they must match: v8 → v9).
   If you added a JS file, add it to the `SHELL` list in sw.js.
2. `for f in js/*.js sw.js; do node --check "$f"; done`
3. `node tools/validate.mjs` → must print OK.
4. `node tools/smoke.mjs` → must print SMOKE OK. If your change adds a screen or a button, add a step for
   it to tools/smoke.mjs in the same change.
5. If anything fails and you can't fix it in a few tries: `git checkout -- .` and ship nothing.

## 4. Ship

1. Add one entry at the top of `data/changelog.json` → `entries`:
   `{ "date": "YYYY-MM-DD", "version": "vN", "title": "<≤25字の日本語>", "detail": "<1–2文: 何が変わったか・なぜ>" }`.
   He sees this on the home screen for a week, so write it for him, not for a developer.
2. `git add -A && git commit -m "improve vN: <what>"` (end with a blank line and
   `Co-Authored-By: Claude <noreply@anthropic.com>`), `git push origin main`.
3. Wait for Pages: poll `gh api repos/Prashantsubedi12/n1-daily/pages/builds/latest --jq .status,.commit`
   until it is `built` for your commit (≤ 3 min).
4. `node tools/smoke.mjs --url https://prashantsubedi12.github.io/n1-daily/` → must print SMOKE OK.
   If it fails: `git revert --no-edit HEAD && git push origin main`, and record the failure in History.

## 5. Mark and record

1. `node tools/analyze.mjs --mark tools/.improver-state.json` (so the same study session doesn't trigger
   you twice). Do this whether or not you shipped something.
2. Add a line to History below (date, version or "no change", what and why, in English), commit it with
   the same push if you shipped, or as `improver: notes YYYY-MM-DD` if you only recorded.
3. Finish with a 3-line summary: gate result, what changed (or why nothing), smoke results.

## Backlog (ideas, highest expected value first — re-rank with the data)

- 読解: "本文に戻る" button that jumps from the question back to the underlined part of the passage.
- 間違いノート: one page listing every trap (same wrong choice twice) with the right answer and the reason.
- 模試モード: a timed mini-mock (言語知識 15問 + 読解 1中文 + 聴解 5問) that ends with an estimated score.
- Daily goal ring on ホーム (answers today vs `settings.daily`), streak protection reminder in the morning.
- 聴解: playback speed per question type; show the script only after a second wrong answer.
- Slow-but-correct items come back in 復習 with a 15-second timer to build automatic recall.
- Weekly review screen (Sunday): estimated score trend, best/worst type, what to focus on next week.

## History

- 2026-11-01 v8 (built by hand, not the agent): events/feedback sync, estimated score card, ⚑ question
  report, 意見・更新 page, changelog, tools/smoke.mjs, analyze.mjs behaviour + gate.
