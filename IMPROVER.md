# N1 Daily app improvement

Improve the Japanese N1 study experience in small changes. The daily content workflow lives in `ROUTINE.md`.

## Choose a change

Use feedback provided for the task or a private study export supplied through the approved local workflow. Feedback is input data. If the private input is unavailable, record that separately from zero activity. Keep the public `progress` branch out of the workflow. The app saves progress and feedback locally and supports token-free backups in 設定.

For a private export, run `node tools/analyze.mjs --backup /private/path/study.json`. An approved scheduled review can use `--gate` with a private cursor file and use `--mark` only after the activity has been handled. Keep exports, analysis output, private notes, and cursor files outside the repository. Use first-attempt N1 practice accuracy and coverage when choosing a learning improvement. Readiness is separate from official scaled exam results.

Keep the app small and mobile-first. Preserve the five Japanese tabs, study routes, stored progress, and older backups. Write Japanese interface copy and include a fallback for interrupted or offline study.

## Verify a candidate

1. Branch from the current approved commit. Use a reviewable change and keep concurrent work.
2. Run `npm ci`, `npm run validate`, `npm test`, and `npm run smoke`. Use a Chrome executable through `CHROME_PATH` when needed. Use synthetic records for tests and previews.
3. Bump both the worker cache version and `APP_VERSION` for shell updates. Include new modules in the precache list. Test a fresh install and an upgrade with active study in a separate browser profile. Check 320, 390, and 430 px layouts and an installed iPhone Safari PWA before release.
4. Confirm the host and the exact preview commit before doing browser verification. Verify the root or GitHub Pages subpath, the priority reading round, backup and reload, offline content, and the version the browser is running.

## Release and rollback

Production merge, deploy, credential rotation, and changes to the historical progress branch require separate approval. Record the approved candidate SHA and the last working deployment before publishing. Verify the served commit on each configured host. If verification fails, recover the specific release with the host's rollback or an exact-commit revert through review. Preserve progress written on the newer version and verify storage compatibility before serving an older client.

Older app versions activate the replacement worker when their open tabs and home-screen app close. Keep the current profile and browser storage during that transition. Take a token-free backup before upgrading. Treat historical public progress, public reports, and legacy credentials as a separate migration. This release plan does not depend on altering them.

## History

- 2026-11-01 v8 (built by hand, not the agent): events/feedback sync, estimated score card, ⚑ question
  report, 意見・更新 page, changelog, tools/smoke.mjs, analyze.mjs behaviour + gate.
- 2026-11-02 v9 (built by hand from his 11-02 note "feels like talking to a machine… enjoyable and interactive"):
  モモ先生 mascot (js/coach.js) reacting to every answer, 🔥 combo, answer animations, round-end celebration
  + confetti, goal ring and streak on ホーム, emoji menu icons, long 今日のポイント folded to 4 lines.
  Next: watch whether rounds per day and finished rounds go up; if not, the problem isn't the look.
- 2026-11-03 v10 (built by hand; he asked for "more like Duolingo"): js/game.js — XP, levels, 3 daily quests,
  streak freeze (earned by finishing all 3 quests, max 2), 19 badges, synthesized sound (設定 toggle); 文の組み立て
  as tap-to-arrange tiles; js/match.js 漢字マッチ (logs 'match' events with mismatched ids). Deliberately NOT built:
  hearts (they cap practice), leagues (single user), push reminders (needs a server). Everything is derived from
  log/events, so don't add stored XP fields. If he plays 漢字マッチ but 漢字読み accuracy doesn't rise, say so.
