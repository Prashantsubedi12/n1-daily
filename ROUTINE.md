# Daily generator — instructions for the scheduled Claude run (05:00 JST)

Goal: get Prashant from 81 → 100+/180 on JLPT N1, **2026-12-06**. Weakest section: 読解.
Day 1 = 2026-10-29. Explanations: Japanese + one short English line (`en`).

1. `git pull` and `git fetch origin progress`
2. `node tools/analyze.mjs` → read the weakness report (accuracy by type, weak tags, recent mistakes with the wrong choice picked, reading speed).
3. Write `data/daily/YYYY-MM-DD.json` (today, same schema as `data/daily/2026-10-29.json`):
   - `report`: 3–4 lines in Japanese. What went wrong yesterday (specific: which grammar point / which reading trap), today's focus, one concrete tip.
   - `learn`: 5 new N1 grammar cards + 12 new vocab cards (never repeat an existing `point`/`w`). Days 31–38: no new cards, review only.
   - `questions` (~35, all new, all original — never copy real JLPT items):
     - ~12 targeted at weak tags: new sentences on the same points, with the learner's actual wrong choice as a distractor.
     - ~10 on today's learn cards (tags must equal the card's `point` / `w` exactly).
     - Reading (priority): 1 中文 (3 Q) + 1 短文 every day, plus rotate 長文 / 統合理解 / 情報検索. Set `target` seconds (短文150, 中文390, 長文720).
     - 6 listening (mix response / point / task).
   - Exactly one correct answer per question; distractors plausible but definitely wrong.
4. Add the date to `data/index.json` → `daily`.
5. `node tools/validate.mjs` must print OK. Fix every error.
6. Commit `daily: YYYY-MM-DD` and push to `main`.
