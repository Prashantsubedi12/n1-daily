# Daily generator — instructions for the scheduled Claude run (~23:10 JST, writes the next day's set)

Goal: get Prashant from 81 → 100+/180 on JLPT N1, **2026-12-06**. Weakest section: 読解.
Day 1 = 2026-10-29. Explanations: Japanese + one short English line (`en`).

1. `git pull` and `git fetch origin progress`
2. `node tools/analyze.mjs` → read the whole report: estimated score per section, accuracy by type, weak tags, recent mistakes with the wrong choice picked, reading speed, traps (same wrong option twice), forgotten items, slow-but-correct items, and reported questions.
   - **Reported questions come first.** For each one, open the file it lives in (`bank` = data/bank/*.json, or the daily file named), read his reason, and fix the question in place (keep the id): make exactly one answer defensible, fix unnatural Japanese, or rewrite the explanation. If it can't be saved, rewrite it as a new question with the same id and tags. Mention the fix in one line of `report`.
   - **Balance by the estimate.** Any section estimated below 19/60 gets at least half of the targeted questions. If 読解 is lowest, add a second 短文. If 聴解 is lowest, raise listening to 9.
   - Traps: write new questions where his exact trap option is a distractor. Forgotten / slow items: new sentences on the same points (not copies).
3. Write `data/daily/YYYY-MM-DD.json` (today, same schema as `data/daily/2026-10-29.json`):
   - `report`: 3–4 lines in Japanese. What went wrong yesterday (specific: which grammar point / which reading trap), today's focus, one concrete tip.
   - `learn`: the 5 grammar points listed for today's day number in `data/curriculum.json` + 12 new vocab cards on that day's vocab theme (never repeat an existing `point`/`w`; grep `data/` first). Days 31–38: no new cards, review only.
   - Card and question ids: `lg-NNN` / `lv-NNN` continue from the highest existing number; question ids are `dMMDD-NN`, passage ids `rd-<kind letter>NN` continuing the existing numbering.
   - `questions` (~35, all new, all original — never copy real JLPT items):
     - ~12 targeted at weak tags: new sentences on the same points, with the learner's actual wrong choice as a distractor.
     - ~10 on today's learn cards (tags must equal the card's `point` / `w` exactly).
     - Reading (priority): 1 中文 (3 Q) + 1 短文 every day, plus rotate 長文 / 統合理解 / 情報検索. Set `target` seconds (短文150, 中文390, 長文720).
     - 6 listening (mix response / point / task).
   - Exactly one correct answer per question; distractors plausible but definitely wrong.
4. Add the date to `data/index.json` → `daily`.
5. `node tools/validate.mjs` must print OK. Fix every error.
6. Commit `daily: YYYY-MM-DD` and push to `main`.
