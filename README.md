# Fathom

A free deep-sea trivia game. You get an open-ended prompt like "Name a fruit" and type one valid
answer before the timer runs out. Rarer answers score more, and every point sinks your diver 10 meters.

The full build spec is in [SPEC.md](SPEC.md).

## What's in it

- **Daily**: the same 7 prompts for everyone, one scored dive per day (resets at midnight Mountain time),
  with streaks, stats, a share card, and an archive of past Dailies to replay.
- **Unlimited**: 7 random prompts, any category, as many runs as you like.
- **Party Dive**: up to 16 friends answer the same prompt at once, then a depth race and podium.
- **Party Battle**: take turns, no repeated answers, everyone watches you type, last diver standing.
- **Friends board**: add friends by code and compare Daily depths.
- **Admin portal** at `/admin`: import, generate, schedule, review, and pool tabs.
- 150 starter questions with about 24,000 answers.

Everything runs on Cloudflare's free plan (no credit card) and uses no paid AI API.

## 1. Try it on your Mac

You need [Node.js](https://nodejs.org) version 20 or newer (the "LTS" download is fine).

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:5173**. The first run sets up a local database with the starter questions.
Press `Ctrl + C` in the terminal to stop. The local admin portal is http://localhost:5173/admin and
its password is in `worker/.dev.vars`.

To test Party mode alone, open the site in two browser windows (one normal, one private).

## 2. Put it online (one time, free)

1. Set up Cloudflare. This opens your browser to log in or make a free account, creates the database,
   and loads the starter questions:

   ```bash
   npm run setup
   ```

2. Publish the site. At the end it prints your live address, like
   `https://fathom.<your-name>.workers.dev`:

   ```bash
   npm run deploy
   ```

3. Make up a long admin password and save it on Cloudflare. Paste it when asked:

   ```bash
   cd worker && npx wrangler secret put ADMIN_TOKEN && cd ..
   ```

4. Save the same password on your Mac for the scripts. Copy `.env.example` to `.env.local`, then
   open `.env.local` and fill in your live address and the password:

   ```bash
   cp .env.example .env.local
   ```

5. Check it worked. This should print your schedule and question counts:

   ```bash
   npm run status
   ```

6. Save the Cloudflare IDs that setup wrote into `worker/wrangler.jsonc`, so future updates keep them:

   ```bash
   git commit -am "Add Cloudflare IDs" && git push
   ```

After any code change, run `npm run deploy` again to update the live site.

## 3. New questions every week

Each week Claude writes 149 questions: 49 for the Daily (7 days × 7) and 100 more for Unlimited.
The full instructions are in [WEEKLY_TASK.md](WEEKLY_TASK.md). The Unlimited pool grows until it hits
2,000 active questions (about 13 weeks), then the oldest, most-played ones rotate out and come back later.

To run it by hand, open Claude Code in this folder and say **"run WEEKLY_TASK.md now"**.

To make it automatic, create a scheduled task in the Claude desktop app (Cowork):

- **Folder**: this project folder
- **Schedule**: every Sunday at 7:00 PM Mountain
- **Prompt**: `Follow WEEKLY_TASK.md in this folder from start to finish.`

Your Mac needs to be on and awake at that time. If a week gets missed, the site keeps working: it
fills empty days from reserve questions automatically.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the whole game on your Mac |
| `npm run setup` | One-time Cloudflare setup |
| `npm run deploy` | Builds and publishes the live site |
| `npm run status` | Shows scheduled days, pool size, and existing prompts |
| `npm run weekly:brief` | Saves this week's question-writing brief |
| `npm run validate:questions -- <file>` | Checks a question file |
| `npm run import -- <file>` | Uploads a question or FIXES file |
| `npm run export:rejected` | Downloads wrong guesses and player reports |
| `npm run pool:refresh` | Keeps the Unlimited pool at its cap |
| `npm test` | Runs the unit tests |
| `npm run sim` | Simulates 6 players in Party Dive and Battle |

Add `-- --local` to the content commands to point them at `npm run dev` instead of the live site.

## Layout

```
/web      website (React + Vite + Framer Motion)
/worker   API, party rooms (Durable Objects), database migrations
/shared   types, config, answer matcher, question format (used everywhere)
/content  question files, weekly logs
/scripts  setup, deploy, dev, and content commands
```

All tunable settings (tier points, timers, penalties, zone depths, Daily time zone, party defaults,
pool cap) live in `shared/src/config.ts`.

Note: the site runs as one Cloudflare Worker at a `*.workers.dev` address (website, API, and party
rooms together), instead of a separate `pages.dev` site. It's simpler to set up and still free.
