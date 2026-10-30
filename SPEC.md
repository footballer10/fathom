# BUILD SPEC — Rare-Answer Deep-Sea Trivia Game (Krillion-style)

You are Claude Code. This file is the complete spec for a web game I'm building for me and my friends. Read the whole file before writing code. Build it in the phases at the bottom, and **stop at the end of each phase** so I can test it before you continue.

---

## 0. Ground rules for you

- Work one phase at a time. At the end of each phase, run the tests, summarize what you built, list anything I need to do, and wait for me.
- **Everything must stay 100% free.** Use only free tiers that need no credit card.
- **Never use the Anthropic API or any paid AI API, and never ask me for an API key.** All question generation happens either through my normal Claude usage (pasting into the admin portal) or through a weekly Claude Cowork scheduled task that runs on my computer (§6).
- If a step needs me (logins, passwords, account creation), stop and tell me exactly what to do.
- Never print, log, or commit secrets. The only secret is `ADMIN_TOKEN`; it goes in `wrangler secret put` and in a gitignored `.env.local`, both of which I set myself. Commit a `.env.example` file with placeholder values only.
- Build all art from scratch as SVG, CSS, or canvas. Don't download, scrape, or copy assets, code, or question data from krillion.io or any other site.
- Use TypeScript everywhere. Keep the code readable and commented where the logic is clever: the matcher, the timers, and the room state machine.
- Commit to git at the end of every phase with a clear message.

---

## 1. What the game is

Players see an open-ended prompt (like "Name a fruit") and type one valid answer before the timer runs out. Any valid answer counts, but **rarer answers score more**. Every point adds 10 meters of depth to your dive.

### Scoring tiers (use these exact names and values)

| Tier | Points | Depth | Meaning |
|---|---|---|---|
| Plankton | 10 | 100 m | Obvious; the first things everyone says |
| Too Clever | 15 | 150 m | Feels clever but is the predictable "clever" pick |
| Schooler | 30 | 300 m | Solid answer past the obvious ones |
| Rare | 60 | 600 m | Uncommon but recognizable |
| Deep Cut | 85 | 850 m | Specialized or obscure but valid |
| One in a Krillion | 100 | 1,000 m | Exactly one per question, chosen because it's satisfying to find |

- A standard game is 7 questions with 25 seconds each. The max score is 700 points, which is 7,000 m.
- **Wrong guess:** subtract 2 seconds from the timer and let the player keep guessing. The first accepted answer locks in the score for that question.
- **Time runs out:** 0 points for that question.
- Keep tier points, timer length, and wrong-guess penalty in `src/shared/config.ts`.

### End-of-dive rating bands (put thresholds in config; I'll tune them after playtesting)

| Zone | Depth |
|---|---|
| Sunlight Zone | 0–999 m |
| Twilight Zone | 1,000–2,499 m |
| Midnight Zone | 2,500–3,999 m |
| Abyssal Zone | 4,000–5,499 m |
| Hadal Zone | 5,500 m and deeper |

### Branding config
- `APP_NAME` lives in config and is used everywhere the title appears. Default: `"Krillion Unlimited"`. I may change it.
- Tier emoji for share cards: Plankton 🦐, Too Clever 🎣, Schooler 🐟, Rare 🐚, Deep Cut 🦑, One in a Krillion 🐋, miss ❌.

---

## 2. Look and feel (laptop-first)

**Built primarily for laptops** with a keyboard. The layout must still work on phones, but laptop is the priority.

### Layout
- A full-screen ocean background. On wide screens, the left or right side shows a **vertical depth gauge** with the diver on it.
- The game sits in a centered column about 720px wide.
- The answer input is large and autofocused. **Enter** submits.
- After a reveal, **Enter or Space** continues. The cursor goes back into the input automatically.
- Put keyboard hints in small print (e.g. "Enter ↵ to submit").

### The dive (main visual)
- The background gradient darkens smoothly as depth increases: bright surface blue → deep blue → near-black.
- A canvas particle layer shows rising bubbles and drifting "marine snow." Target 60fps, and pause the particles when the tab is hidden.
- The diver sinks smoothly by exactly the points earned, using an eased animation that takes about 1.2 seconds.
- Creatures fade in by zone, all as original SVGs:
  - Small fish in the Sunlight Zone
  - Jellyfish in the Twilight Zone
  - A glowing anglerfish in the Midnight Zone
  - Tube worms and a dark seafloor in the Hadal Zone

### Tier reveal
- The answer card pops in with the tier's color and emoji, and the points count up.
- The depth gauge ticks down at the same time.
- Higher tiers get bigger effects. One in a Krillion gets a special burst and screen glow.

### Timer and input feedback
- The timer is a ring around the input box that drains as time runs out. It turns red under 5 seconds.
- A wrong guess makes the input shake and shows a brief "−2s" floating up.
- If autocorrect fixed the guess, show small text under the card: "Accepted as **Persimmon**."

### Style and settings
- Clean and minimal: one sans-serif font, rounded cards, a soft glassy look over the ocean, and dark mode by default.
- Settings: sound on/off (sonar ping on accept, soft thud on miss, bubble pops), reduced motion (respects `prefers-reduced-motion`), and particles on/off.
- Animation stack: Framer Motion for UI, canvas for particles, CSS for gradients.

---

## 3. Modes

### 3.1 Daily
- Everyone gets the same 7 questions. The set resets at midnight in `DAILY_RESET_TZ`, which is set in config.
- **All questions are equally difficult.** There is no difficulty ramp and no difficulty field. Every question should be as accessible as every other one.
- One scored attempt per player ID. If the player refreshes mid-game, they resume where they left off; the server tracks the session.
- **End screen** shows:
  - Total depth and zone rating
  - Per-question tiers
  - "Deeper than X% of today's divers" (computed from real results; hide it until there are at least 5 results)
  - The rarest answer anyone gave today
  - A countdown to the next Daily
  - A share card
- **Reveal panel:** after each question (or on the end screen), show the full valid answer list grouped by tier, with the player's answer highlighted.
- **Share card** (copy to clipboard, no spoilers):
  ```
  Krillion Unlimited #42 — 3,650 m (Midnight Zone)
  🐟🐚🦐🦑🐚❌🐋
  ```
- **Streaks and stats** (stored on the server by player ID): current streak, best streak, average depth, and a tier histogram.

### 3.2 Unlimited
- Each run gives 7 random questions from the Unlimited pool, with no daily limit.
- Track seen question IDs per player, and avoid repeats until the player has seen 80% of the pool.
- Optional category filter.
- **It must never serve questions that are scheduled for an upcoming Daily.**
- Same end screen as Daily, but no percentile.

### 3.3 Party — Dive (synced race)

**Lobby**
- The host clicks "Create room" and gets a 4-letter code. Letters come from `ABCDEFGHJKMNPQRSTUVWXYZ` (no I, L, or O).
- The host can share the code or a link (`/room/ABCD`). Friends join with a nickname.
- Max 16 players. Rooms expire after 2 hours idle.

**Host settings**
- Question source: today's Daily set, random Unlimited questions, or a category.
- Question count: 3–15 (default 7).
- Timer: 15, 25, or 40 seconds (default 25).
- "Unique answers" toggle (default off): if two or more players give the same answer, each of them gets half points.

**Play**
- Everyone answers the same prompt on a **server-authoritative clock**.
- Players see who has locked in, but not what they answered.

**After each question**
- Reveal every player's answer with its tier.
- Animate the leaderboard reshuffling.

**Finale**
- All divers sink side by side in a depth race animation, then a podium screen for 1st, 2nd, and 3rd.
- Ties are broken by less total time used.

**Edge cases**
- Late joiners can spectate until the next game.
- Reconnecting players rejoin their seat using their player ID.
- If the host leaves, the oldest connected player becomes host.

### 3.4 Party — Battle (turn-based)

Same lobby and code system as Dive. Max 12 players.

**Turns**
- Players take turns, one at a time, all answering the current prompt.
- Everyone sees the active player **typing live** (throttled to about 10 updates per second).

**No repeats**
- An answer already accepted on the current prompt is rejected for everyone else.
- If a guess matches a used answer, show "Already taken" and apply the wrong-guess penalty.

**Turn timer (it resets every turn)**
- Every turn gets the base time; rare answers don't add bonus time.
- Wrong guess: −1s, configurable.

**Lives**
- Running out of time on your turn costs 1 life.
- Each player's lives sit inside a circle that fills with every accepted answer. A full circle becomes one extra life (no cap), and any overflow carries into the next circle:

  | Tier | Circle filled |
  |---|---|
  | One in a Krillion | a full circle |
  | Deep Cut | 1/2 |
  | Rare | 1/4 |
  | Schooler | 1/8 |
  | Too Clever | 1/16 |
  | Plankton | 1/32 |

- At 0 lives you're eliminated. Eliminated players become spectators and can still type guesses for fun; these are unscored and shown in a side panel.

**Prompt rotation**
- The prompt switches to a new one when any of these happens:
  - 2 failed turns on the current prompt (host setting, 1–5), or
  - N accepted answers on the current prompt (host setting; default = 2 × alive players), or
  - fewer than 5 unused valid answers remain.
- Show a big "NEW PROMPT" transition.

**Speed-up (host toggle, default on)**
- Base time drops 1 second each time the prompt rotates, down to a minimum of 4 seconds.

**Winning**
- The last player standing wins. Show a final screen with the best answer of the game.

**Host settings**
- Lives: 1–5 (default 3)
- Base time: 6–20s (default 10s)
- Rotation thresholds
- Speed-up on or off
- Categories

---

## 4. Answer matching and autocorrect

**Requirement:** a guess must be checked and answered within 1 second. Targets:
- Matcher CPU time under 2ms per guess
- p95 response time under 300ms for solo modes
- Under 100ms inside party rooms, where answers are already in memory

### Where matching runs
Matching runs **on the server only**. Answer lists are never sent to the browser before a question is finished.
- In solo modes, the Worker loads the question's precompiled answer index from KV and caches it in memory.
- In party rooms, the Durable Object loads all indexes for the game when the game starts.

### Precompiled index (built at seed or generation time, stored as JSON in KV under `qidx:<questionId>`)
- A map from normalized string → answer ID, covering every canonical answer and every alias
- Each answer's normalized forms grouped by length, for fast fuzzy prefiltering
- Each normalized form's Double Metaphone codes
- The question's normalized `nearMisses` list (known invalid answers people commonly try)

### Matching pipeline, in order

1. **Normalize the guess:**
   - Unicode NFKD, then strip diacritics
   - Lowercase and trim; collapse repeated spaces
   - Remove punctuation; convert `&` to `and`
   - Drop a leading "the", "a", or "an"
   - Simple singularization (rules plus an exceptions list, e.g. `geese` → `goose`, and don't singularize words like `asparagus` or `bus`)
   - Normalize US/UK spelling pairs from a small built-in table (colour/color, grey/gray, -ise/-ize)

2. **Exact lookup** in the map. If found, accept. This covers canonical answers, aliases, and pre-generated misspellings.

3. **Near-miss block:** if the normalized guess exactly matches a `nearMisses` entry, reject it.

4. **Fuzzy match** using Damerau-Levenshtein distance (transpositions count as 1 edit).
   - Only compare against forms whose length is within ±3 of the guess.
   - Allowed distance depends on the length of the normalized guess:

     | Length | Max distance |
     |---|---|
     | 4 or fewer | 0 |
     | 5–7 | 1 |
     | 8–11 | 2 |
     | 12 or more | 3 |

   - **Ambiguity guard:** accept only if exactly one *answer* falls within the threshold, and that answer is strictly closer than any near-miss entry. Forms belonging to the same answer count as one.
   - Example: Austria vs Australia — if both are valid and a guess is equally close to both, reject it.

5. **Phonetic match:** if the guess's Double Metaphone code equals the code of exactly one answer, and the edit distance is at most (threshold + 1), accept it. Example: "fushia" → "fuchsia."

6. **Multi-word tolerance:**
   - Ignore extra spaces and hyphens ("ice cream" = "icecream" = "ice-cream").
   - Allow word-order swaps for answers with 2–3 words.

7. **Return** `{ accepted, answerId, canonical, tier, points, corrected, reason }`.
   - `corrected` is true when steps 4–6 made the match; the UI then shows "Accepted as …".
   - `reason` is one of: `wrong`, `taken`, `late`, or `ambiguous`. Use it in logs only; the player just sees "Not accepted" (or "Already taken" in Battle).

### Learning loop (handles "obvious what they meant" without any paid AI)
- Log every rejected guess to `rejected_guesses` with: question ID, normalized guess, count, closest answer, and its distance.
- `GET /api/admin/rejected-export` returns rejected guesses seen at least 2 times plus all "this should count" reports, formatted as plain text ready to hand to Claude.
- The weekly task (§6) pulls this export, decides for each one whether it's a misspelling of an answer, a valid missing answer, or invalid, and writes a **FIXES** block (format in §5).
- I can also do this by hand: copy the export from the portal's Review tab, paste it into a normal Claude chat, then paste Claude's FIXES output back into the Import tab.
- Importing FIXES adds aliases, answers, or near-misses, then rebuilds the KV index for every question that changed.

### Generation-time aliases
Every generated question includes the common misspellings, nicknames, abbreviations, and alternate names for each answer, stored as aliases. Examples: "brocoli," "brussel sprouts," "USA," "DRC."

### No live AI
There is no live AI fallback. Matching is fully deterministic and runs in milliseconds.

### Tests (required)
Unit-test the matcher with a table of cases:
- Typos and transpositions
- Accents ("creme brulee")
- Plurals
- Iran/Iraq and Austria/Australia
- Near-miss blocking (e.g. "Switzerland" for an EU-countries prompt)
- Phonetic matches
- Multi-word variants
- Already-taken answers in Battle

Add a benchmark test showing the matcher stays under 2ms on a question with 300 answers and 1,000 aliases.

---

## 5. Question bank

### What makes a good prompt
- **Easy entry:** almost anyone can name at least one answer within 5 seconds.
- **Big pool:** at least 50 valid answers. Target 80–250. The validator fails any question under 50 and warns under 80.
- **Clear boundary:** the prompt makes it obvious what counts.
- **Stable facts:** nothing that changes often, like current rosters or "currently airing" shows.
- Prompts are 80 characters or less.
- **Every question should be about equally difficult:** a typical player should be able to name several valid answers, and a strong player should be able to reach Rare or better with some thought. Avoid prompts that are much easier or much harder than that.

### Categories
Use at least these, with tags in the data: food, animals, geography, sports, music, movies-tv, words-language, science, brands, everyday-objects, history, games-toys, jobs-people, body-health, vehicles, nature.

Example prompts:
- Name a fruit
- Name a dog breed
- Name a country in Africa
- Name a musical instrument
- Name a board game
- Name a chemical element
- Name a word ending in "-ology"
- Name something in a kitchen
- Name a car brand
- Name a sport played with a ball
- Name a breakfast cereal
- Name an animal that lives in the ocean
- Name a job title
- Name a vegetable
- Name a fast food chain
- Name a body part
- Name a US city
- Name a famous painter
- Name a type of cheese
- Name a candy

### Rarity rules
Every valid answer goes in exactly one tier. Target distribution for a pool of about 120 answers (scale for other sizes):

| Tier | Target |
|---|---|
| Plankton | only the 3–5 answers almost everyone says first |
| Too Clever | 2–5 "clever but predictable" picks |
| Schooler | about 25% |
| Rare | about 33% |
| Deep Cut | the rest |
| One in a Krillion | exactly 1 — chosen because it's fun and surprising to find, valid without argument, not just the most obscure answer |

### JSON format (`content/questions/<batch>.json` holds an array of these)
```json
{
  "id": "q0142",
  "prompt": "Name a fruit",
  "category": "food",
  "answers": [
    { "text": "Banana", "aliases": ["bananas", "banan"], "tier": 10 },
    { "text": "Dragon fruit", "aliases": ["pitaya", "pitahaya", "dragonfruit"], "tier": 15 },
    { "text": "Persimmon", "aliases": ["persimon"], "tier": 60 },
    { "text": "Jabuticaba", "aliases": ["jaboticaba"], "tier": 100 }
  ],
  "nearMisses": ["tomato sauce"],
  "notes": "Botanical edge cases (tomato, cucumber) accepted as Too Clever."
}
```

### Plain-text format (for pasting and for the weekly task)
JSON is the internal format, but everything I paste in, and everything the weekly task writes, uses this simpler plain-text format. Build a parser and a serializer for it in `/shared`, with tests.

```
# QUESTION
date: 2026-11-02
slot: 1
category: food
prompt: Name a fruit
note: Botanical edge cases (tomato, cucumber) count as Too Clever.

[One in a Krillion]
Jabuticaba | jaboticaba

[Deep Cut]
Cherimoya | custard apple
Salak | snake fruit

[Rare]
Persimmon | persimon
Gooseberry

[Schooler]
Apricot
Cantaloupe | cantelope

[Too Clever]
Dragon fruit | pitaya | pitahaya | dragonfruit
Tomato

[Plankton]
Apple | apples
Banana | bananas | banan

[Not accepted]
Tomato sauce
```

Rules:
- `# QUESTION` starts each question. A file can hold any number of questions.
- `date:` and `slot:` (1–7) put the question in that day's Daily set. Use `pool: unlimited` instead to add it straight to Unlimited.
- `category:`, `prompt:`, and the tier sections are required. `note:` is optional.
- Each answer line is the canonical answer, then any aliases, separated by `|`.
- `[Not accepted]` lines become near-misses.
- Blank lines and lines starting with `//` are ignored. Tier headers are case-insensitive.

**FIXES block** (from the learning loop):
```
# FIXES
question: q0142
alias: Persimmon | persimen
add: Rare | Salak | snake fruit
reject: tomato sauce
```
- `alias:` adds aliases to an existing answer.
- `add:` adds a new answer with its tier and aliases.
- `reject:` adds a near-miss.

### Validator (`npm run validate:questions`)
Fails if any of these are true:
- Invalid JSON or schema mismatch
- Fewer than 50 answers
- Not exactly one tier-100 answer
- Duplicate normalized strings across answers or aliases
- A near-miss collides with a valid answer
- A category isn't in the allowed list
- A prompt duplicates an existing prompt (after normalization)
- A date already has a question in that slot (unless the import is marked "replace")

Warns if any of these are true:
- Tier counts are outside the target ranges
- Two different answers have forms within edit distance 1 of each other (a fuzzy-ambiguity risk); list them

### Seed bank (Phase 2)
- **You write the seed bank yourself.** Write 150 questions, in batches of 10 per file, across all categories.
- Run the validator after every batch and fix every error before moving on.
- Mark 28 of them as `reserve`. These are the Daily fallback, used only when a date has no scheduled set, and never shown in Unlimited until they've aired. The rest go in `unlimited`.
- `npm run seed` loads everything into D1 and builds the KV indexes.

---

## 6. Getting new questions in (free: no API, just my Claude usage)

The Daily needs 7 new questions a day, so 49 a week. They come in one week at a time, two ways: a **weekly automated task** (the normal way) or **paste-in through the admin portal** (manual backup). Both use the plain-text format from §5.

### 6.1 Admin portal (`/admin`)
Protected by `ADMIN_TOKEN`: I enter it once, and it's kept in the browser's localStorage. Tabs:

- **Import**
  - A big paste box. "Check" parses the text and runs the validator, then shows a preview per question with errors in red and warnings in yellow.
  - "Import" is disabled until there are no errors. Options: "use dates in the file" (default), "fill the next open dates," or "add all to Unlimited."
  - Also accepts FIXES blocks.
  - Also accepts a dropped `.txt` file.
- **Generate**
  - A button that builds a ready-to-copy prompt for a normal Claude chat. The prompt includes:
    - The next 7 open dates and their slots
    - The full plain-text format and rarity rules from §5
    - The equal-difficulty rule
    - The list of every existing prompt, so nothing repeats
    - A category spread for the week
  - A "Copy" button.
  - The prompt asks Claude for **one day (7 questions) per reply**, then to keep going with "next" until all 7 days are done, because a full week won't fit in one reply.
- **Schedule**
  - The next 21 days, showing which dates are filled.
  - I can open, edit, swap, or delete any scheduled question.
  - A banner appears if fewer than 7 future days are filled.
- **Review**
  - Rejected guesses and reports, with a "Copy export for Claude" button (§4 learning loop).
- **Pool**
  - Unlimited pool size, retired questions, and per-question stats.

### 6.2 Weekly task (runs as a Claude Cowork scheduled task on my computer)
In Phase 4, write `WEEKLY_TASK.md` in the repo root. It contains complete, self-contained instructions that Claude follows each week with no help from me. The task:

1. Read `config` and `.env.local` (`SITE_URL`, `ADMIN_TOKEN`).
2. Run `npm run status`, which calls `/api/admin/status` and prints:
   - The next open dates
   - The existing prompts list
   - The category usage for the last 4 weeks
   - The Unlimited pool size
3. Write 7 days × 7 questions for the next open week in the plain-text format, saved to `content/incoming/<first-date>.txt`.
   - Follow all the rules in §5, including equal difficulty.
   - No repeated category within a day; spread categories across the week.
4. **Self-review pass:** re-read every question and fix anything wrong:
   - Missing common answers
   - Invalid answers
   - Tier mistakes
   - A weak One in a Krillion pick
   - Missing misspellings and aliases
5. Run `npm run validate:questions -- content/incoming/<file>.txt` and fix every error. Repeat until it passes.
6. Run `npm run import -- content/incoming/<file>.txt`, which uploads to the admin import endpoint.
7. **Learning loop:**
   - Run `npm run export:rejected`, decide on each item, and write `content/incoming/fixes-<date>.txt`.
   - Validate and import it.
8. **Refresh Unlimited:** run `npm run pool:refresh`. If the active Unlimited pool is over `UNLIMITED_POOL_CAP` (default 400), it retires the oldest and most-played questions down to the cap. **Retired questions are kept, never deleted**, and can rotate back in later.
9. Move the imported files to `content/imported/`, then write a short summary at `content/logs/<date>.md` covering:
   - What was added
   - Any fixes applied
   - Anything that failed

Requirements:
- **If the upload step fails**, leave the `.txt` file in `content/incoming/` and say so clearly in the summary, so I can paste it into the portal by hand.
- **Buffer:** the task should keep at least 14 days scheduled ahead. If more than one week is open, it fills two weeks.
- **Fallback:** if a date ever has no set, the server builds that day from `reserve` automatically, then from Unlimited questions not shown in the last 90 days.
- Also document in `WEEKLY_TASK.md` how I can run it by hand ("run WEEKLY_TASK.md now").

### 6.3 Aired Dailies become Unlimited
- No cron job is needed. A question whose Daily date is before today (Mountain time) counts as part of the Unlimited pool automatically.
- **Unlimited grows by 49 questions a week** just from Dailies.
- `pool:refresh` keeps the pool at the cap.

## 7. Architecture

| Part | Choice |
|---|---|
| Frontend | React + TypeScript + Vite, Framer Motion, Tailwind (or CSS modules); static hosting on **Cloudflare Pages** |
| API | **Cloudflare Workers** (Hono router) |
| Database | **Cloudflare D1** (SQLite) |
| Answer indexes and caching | **Cloudflare KV** |
| Party rooms | **Durable Objects**: one per room code, SQLite-backed (required on the free plan), using the WebSocket Hibernation API |
| Scheduled content updates | Weekly Claude Cowork task on my computer (§6.2); no cloud cron, no API |
| Code hosting | GitHub, free and optional (backup and version history) |
| Tests | Vitest (unit), Playwright (end-to-end), plus a Node script that simulates 6 WebSocket clients for party modes |

Monorepo layout:
```
/web      frontend
/worker   API + Durable Objects
/shared   types, config, matcher, validator (used by worker, web, and scripts)
/content  question JSON
/scripts  seed, validate, import, status, export:rejected, pool:refresh
```

### Player identity
- No accounts. On first visit, create a random `playerId` (UUID) and save it in localStorage.
- Ask for a nickname when the player first enters party mode or the friends leaderboard.
- Filter profanity in nicknames using a simple word list.

### D1 tables (adjust as needed)

| Table | Columns |
|---|---|
| `questions` | id, prompt, category, status (`reserve`/`scheduled`/`unlimited`/`retired`), daily_date, daily_slot, source (`seed`/`weekly`/`paste`), created_at, retired_at |
| `answers` | id, question_id, canonical, tier |
| `aliases` | answer_id, normalized |
| `near_misses` | question_id, normalized |
| `daily_sets` | date (PK), question_ids (JSON), status |
| `sessions` | id, player_id, mode, date, question_ids, current_index, question_started_at, state JSON |
| `plays` | session_id, question_id, answer_id or null, points, ms_used, corrected |
| `daily_results` | player_id, date, points, tiers JSON — UNIQUE(player_id, date) |
| `players` | id, nickname, created_at |
| `rejected_guesses` | question_id, normalized, count, closest_answer_id, distance, last_seen |
| `reports` | question_id, guess, player_id, created_at, status |
| `answer_stats` | answer_id, times_chosen (for future re-tiering from real data) |

### API (all JSON)

| Endpoint | Purpose |
|---|---|
| `GET /api/daily` | Today's number, prompts (no answers), and reset time |
| `POST /api/session/start` | Start a session: `{ mode: daily or unlimited, category? }`. Daily refuses if the player already finished today; resumes if in progress |
| `POST /api/session/:id/guess` | Check a guess: `{ index, text }` → matcher result. The server enforces the deadline using `question_started_at` (+250ms grace) and applies the wrong-guess penalty |
| `POST /api/session/:id/next` | Move to the next question; the server sets `question_started_at` |
| `GET /api/session/:id/reveal/:index` | Full answer list by tier. Only allowed once that question is finished |
| `POST /api/session/:id/finish` | Totals, zone, percentile, rarest-answer-today |
| `GET /api/stats/me` | Streaks and histogram |
| `POST /api/report` | "This should count" |
| `POST /api/rooms` | Create a room → `{ code }` |
| `GET /ws/rooms/:code` | WebSocket upgrade to the room's Durable Object |
| `/api/admin/*` | Admin endpoints (Bearer `ADMIN_TOKEN`): `status`, `import`, `schedule`, `rejected-export`, `pool-refresh`, question edit and delete |

### Realtime protocol (JSON messages, a `type` field on each)
- **Client → server:** `join {playerId, nickname}`, `settings {…}` (host only), `start` (host only), `guess {text}`, `typing {text}` (Battle only), `ping {t}`
- **Server → client:** `state {full snapshot}`, `pong {t, serverNow}`, `question {index, prompt, endsAt}`, `locked {playerId}`, `guessResult {…}` (sent only to the guesser), `reveal {perPlayer, leaderboard}`, `turn {playerId, endsAt, prompt}`, `typing {playerId, text}`, `taken {answerCanonical, byPlayerId}`, `lifeLost {playerId, livesLeft}`, `eliminated {playerId}`, `rotate {prompt}`, `gameOver {results}`

**Timing**
- The Durable Object owns all timers, using alarms.
- Clients sync clocks with ping/pong and render countdowns from `endsAt`.
- Clients reconnect automatically with backoff.

---

## 8. Phases and acceptance checks

**Phase 1 — Solo game, frontend first**
- Build the full visual experience: dive background, particles, depth gauge, tier reveals, timer ring, end screen, share card, settings, and laptop-first layout.
- Use a local mock API with 20 hand-written questions.
- Daily and Unlimited flows both work locally.
- Matcher v1 lives in `/shared`, with unit tests passing.
- **Stop for review.**

**Phase 2 — Question bank**
- 150 questions, validator, and seed script.
- The matcher is complete (all pipeline steps), with tests and the benchmark passing.
- **Stop for review.** I'll spot-check questions.

**Phase 3 — Real backend and deploy**
- Workers, D1, KV, and sessions with server-enforced timers.
- Reveal, stats, streaks, percentile, and reports.
- Deploy to `*.pages.dev` with `npm run deploy` (runs locally through Wrangler), then hand me the live URL.
- **Stop for review.** Measure and report p95 guess latency from my laptop.

**Phase 4 — Content pipeline**
- Plain-text parser and serializer with tests.
- Admin portal (all tabs in §6.1).
- `status`, `import`, `export:rejected`, and `pool:refresh` scripts.
- `WEEKLY_TASK.md`.
- Run the weekly task once yourself, end to end, as a test.
- Then give me exact step-by-step instructions for creating the weekly Claude Cowork scheduled task. Default schedule: every Sunday at 7:00 PM Mountain.
- **Stop for review.**

**Phase 5 — Party: Dive**
- Rooms, lobby, synced questions, reveals, leaderboard, finale race, reconnect, host migration.
- The 6-client simulation test passes.
- **Stop for review.**

**Phase 6 — Party: Battle**
- Turns, live typing, no-repeat answers, per-turn timer based on the last answer, lives, rotation rules, speed-up, spectators.
- Simulation test passes.
- **Stop for review.**

**Phase 7 — Polish**
- Friends leaderboard: add friends by sharing a friend code.
- Archive of past Dailies.
- Sound effects.
- Re-tiering from real data: once a question has 300+ plays, suggest tier changes in the admin page based on `answer_stats`.
- Performance pass.

---

## 9. Config and secrets

`src/shared/config.ts`:
- `APP_NAME = "Krillion Unlimited"`
- `DAILY_RESET_TZ = "America/Denver"` (Mountain time; must handle daylight saving automatically)
- Tier points
- Timer length and wrong-guess penalties
- Zone thresholds
- Battle defaults
- `QUESTIONS_PER_DAY = 7`
- `UNLIMITED_POOL_CAP = 400`
- `SCHEDULE_BUFFER_DAYS = 14`

The only secret is `ADMIN_TOKEN`, a long password I make up myself:
- Worker secret: `npx wrangler secret put ADMIN_TOKEN`
- Local file: `.env.local` (gitignored) with `SITE_URL` and `ADMIN_TOKEN`, used by the scripts and the weekly task

**No API keys of any kind.**
