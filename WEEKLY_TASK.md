# Weekly question task

These are complete instructions for Claude. Each week Claude writes **149 new questions**:

- **49 Daily questions**: 7 days × 7 questions, scheduled onto the next open dates.
- **100 Unlimited questions**: added straight to the Unlimited pool.

Every Daily also joins Unlimited the day after it airs, so the Unlimited pool grows by about
149 questions a week. The active pool is capped at **2,000** (`UNLIMITED_POOL_CAP` in
`shared/src/config.ts`), which it reaches after roughly 13 weeks. From then on `pool:refresh`
retires the oldest, most-played questions to stay at the cap, and brings back questions that have
been retired for 180+ days. Nothing is ever deleted, so the full bank keeps growing.

To run it by hand, open Claude Code in this folder and say: **"run WEEKLY_TASK.md now"**.

---

## Instructions for Claude

### Rule #1: every valid answer must be accepted

**This matters more than anything else in this task.** Nothing is more frustrating for a player
than typing a really good, correct answer and having it marked wrong. Every question you write must
accept every true answer a smart player could type.

- Only write a prompt whose full set of answers you can list. If the honest set is too big (any
  city, any bird, any song, any job), add a constraint that closes it to a fixed, checkable list:
  "Name a US city" becomes "Name a US state capital".
- List every valid answer, including the obscure ones. Never trim a list to hit a target size.
- Add aliases for misspellings, plurals, abbreviations, nicknames, surnames on their own, and names
  with and without "The".
- For every question, brainstorm at least 20 more true answers and check each against the list.
  Add whatever is missing. Repeat until a round finds nothing new.
- When in doubt between a smaller tidy question and a complete one, choose complete, or drop the
  question and write a different one.

The full rule, with examples, is "THE MOST IMPORTANT RULE" at the top of the brief.

### Ground rules

Work in the repository root. Never print, log, or commit the contents of `.env.local`. Never use
any paid AI API; you write every question yourself. Don't copy questions or answer lists from any
website.

In a cloud session there is no `.env.local`. The scripts read `SITE_URL` and `ADMIN_TOKEN` from
environment variables instead, so don't create the file. If `git push` is refused on the default
branch, push to the branch the session gives you; the site reads questions from the database, so
the git copy is only a backup.

### Pace yourself: one file at a time, save as you go

This task runs on the owner's Claude plan, which has a usage limit per 5-hour window.

- **Do not use subagents, helper agents, or parallel writers.** Write every file yourself, one
  after another. Parallel helpers each reread the whole brief and burn through the limit in
  minutes.
- **Finish each file completely before starting the next:** write it, self-review it (step 6),
  validate it (step 7), upload it (step 8), then commit and push it:
  ```bash
  git add content && git commit -m "Weekly questions: <file name>" && git push
  ```
  That way, if the usage limit is hit partway through, everything finished so far is already live
  and saved.
- **Resuming:** before writing anything, check `content/incoming/` and `content/imported/` for
  this week's files. Upload any finished file that hasn't been imported yet, and skip work that's
  already done. Run `npm run status` to see which Daily dates are still open.
- Order of work: Dailies first (they're needed soonest), then the Unlimited files.

### 1. Get up to date

```bash
git pull
npm install
```

### 2. Check what's needed

```bash
npm run status
```

Read the output. Note the next open Daily dates, the category usage, and the pool size.

- If **"Days fully scheduled ahead"** is 7 or more below the 14-day buffer (so two weeks are open),
  do this whole task twice: two weeks of Dailies (98) plus 100 Unlimited.
- If no Daily dates are open, skip the Daily part and still write the 100 Unlimited questions.

### 3. Get the writing brief

```bash
npm run weekly:brief
```

For two weeks of Dailies, use `npm run weekly:brief -- --days 14` instead.

This saves `content/incoming/brief-<today>.txt`. Read **all** of it. It has the open dates, every
question rule (tiers, aliases, misspellings, equal difficulty, the Too Clever and Near Miss
sections), the plain-text format, the categories to favor, and the full list of existing prompts.
Nothing you write may repeat or closely rephrase an existing prompt. The files in `content/seed/`
are good examples of finished questions.

### 4. Write the Dailies

Write the 49 Daily questions into **one file**: `content/incoming/<first-open-date>-daily.txt`.

- Use the `date:` and `slot:` lines from the brief for each question (slots 1–7).
- Don't repeat a category within a day, and spread categories across the week.
- All 7 questions on a day should feel about equally hard.

Write one day at a time, then go back and do the next day, so each day gets full attention.

### 5. Write the 100 Unlimited questions

Write them in four files of 25:
`content/incoming/<first-open-date>-unlimited-1.txt` through `-unlimited-4.txt`.

- Use `pool: unlimited` instead of `date:` / `slot:`.
- Cover every category; lean toward the least-used ones from the brief.
- No prompt may repeat an existing prompt or another prompt you wrote this week.

### 6. Self-review pass

Re-read every question you wrote and fix:

- **Completeness (Rule #1).** Do the 20-answer brainstorm check on every single question again.
- **Open-ended prompts.** For every question ask: "Could a smart player type something true that
  isn't on this list?" If yes, add the missing answers, or add a constraint to the prompt that closes
  the set to a fixed, checkable list (see "THE MOST IMPORTANT RULE" in the brief). "Name a US city"
  is too open; "Name a US state capital" is closed.
- Missing common answers (the Plankton tier should cover what most people would type)
- Invalid answers, and answers placed in the wrong tier
- A weak One in a Krillion pick (it should be real, checkable, and very rare)
- Missing misspellings and aliases on answers people often misspell
- Prompts that are ambiguous or that have too few valid answers

### 7. Validate until clean

```bash
npm run validate:questions -- content/incoming/<first-open-date>-daily.txt
```

Run it for each of the five files. Fix every **error** and run it again until each file passes.
Warnings are fine to leave if you've looked at them and they're intended.

### 8. Upload

```bash
npm run import -- content/incoming/<first-open-date>-daily.txt
```

```bash
npm run import -- content/incoming/<first-open-date>-unlimited-1.txt content/incoming/<first-open-date>-unlimited-2.txt content/incoming/<first-open-date>-unlimited-3.txt content/incoming/<first-open-date>-unlimited-4.txt --unlimited
```

If the Daily import reports that a date or slot is already taken, re-run it with `--fill` so it
uses the next open slots instead.

### 9. Learning loop (fix rejected guesses)

```bash
npm run export:rejected
```

This saves `content/incoming/rejected-<today>.txt`: wrong guesses that players typed at least
twice, plus "this should count" reports. For each item decide:

- **Misspelling** of an existing answer → add it as an alias of that answer.
- **Valid answer that's missing** → add it as a new answer in the right tier.
- **Invalid** → leave it out (or add it to Near Miss if it's a common wrong answer worth blocking).

Write the decisions as FIXES blocks in `content/incoming/fixes-<today>.txt`, one block per
question (the export shows each question's id):

```
# FIXES
question: q0142
alias: Persimmon | persimen
add: Rare | Salak | snake fruit
reject: tomato sauce
```

- `alias: <existing answer> | <new spelling> | ...` adds misspellings or other names to an answer.
- `add: <tier> | <answer> | <aliases...>` adds a missing answer (tier names: Plankton, Too Clever,
  Schooler, Rare, Deep Cut).
- `reject: <guess>` adds a common wrong answer to Not accepted.

Validate it, then import it:

```bash
npm run validate:questions -- content/incoming/fixes-<today>.txt
```

```bash
npm run import -- content/incoming/fixes-<today>.txt
```

If the export is empty, skip this step.

### 10. Refresh the Unlimited pool

```bash
npm run pool:refresh
```

### 11. Tidy up and log

- Move every file you imported successfully from `content/incoming/` to `content/imported/`.
  Delete the brief and the rejected export (they're regenerated each week).
- Write `content/logs/<today>.md` with:
  - How many Daily and Unlimited questions were added, and the dates filled
  - The fixes applied
  - The pool size before and after the refresh
  - Anything that failed, and which files are still waiting in `content/incoming/`
- Download a full backup of every live question (it writes `content/backup/`):

```bash
npm run backup
```

- Commit and push the question files, the backup and the log (never `.env.local`):

```bash
git add content/imported content/logs content/backup
git commit -m "Weekly questions <today>"
git push
```

### If something fails

- **Upload fails** (network, server down, wrong token): leave the `.txt` files in
  `content/incoming/` and say so clearly at the top of the log, so they can be pasted into the
  admin portal's Import tab (`<SITE_URL>/admin`) by hand.
- **Validation won't pass** for a question after several tries: delete that question from the
  file, upload the rest, and note it in the log.
- **Days run out**: the site never goes blank. If a date has no set, the server builds that day
  from `reserve` questions, then from Unlimited questions not shown in the last 90 days.
