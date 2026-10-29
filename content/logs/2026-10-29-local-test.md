# Weekly task test run (local), 2026-10-29

A shortened run of WEEKLY_TASK.md against the local dev server (`--local`), to prove every step works.
Nothing was sent to the live site.

- `npm run status`: 0 days scheduled ahead, pool 122 active / 21 reserve.
- `npm run weekly:brief -- --days 1 --unlimited 2`: brief saved with dates, rules, format and existing prompts.
- Wrote 1 Daily ("Name a nut or seed people eat", 2026-10-29 slot 1) and 1 Unlimited
  ("Name a cocktail or mixed drink"). Both validated (warnings only: under 80 answers).
- `npm run import`: both uploaded (q0152 scheduled, q0153 to Unlimited).
- `npm run export:rejected`: 1 question with test guesses; wrote a FIXES block for q0153
  (1 alias, 1 new answer "Gin Fizz", 1 reject), validated and imported. Confirmed "Gin Fizz" is now on the question.
  The alias "mojitos" was skipped on purpose because it already matches "Mojito".
- `npm run pool:refresh`: 123 → 123 (cap 2000), nothing to retire yet.
- Test files were deleted afterwards since they only exist in the local database.

Result: all steps passed.
