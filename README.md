# Krillion Unlimited

A free deep-sea trivia game. You get an open-ended prompt like "Name a fruit" and type one valid
answer before the timer runs out. Rarer answers score more, and every point sinks your diver 10 meters.

The full build spec is in [SPEC.md](SPEC.md).

## Status: Phase 1 (solo game, frontend first)

- Full visual dive: ocean gradient that darkens with depth, canvas bubbles and marine snow,
  zone creatures (fish, jellyfish, anglerfish, tube worms), vertical depth gauge, timer ring,
  tier reveal cards with bursts, end screen, share card, and settings.
- Daily and Unlimited modes, played against a **local mock API** with 20 hand-written questions.
- Matcher v1 in `shared/` with unit tests and a speed benchmark.

## Run it on your Mac

You need [Node.js](https://nodejs.org) version 20 or newer (the "LTS" download is fine).

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser. Press `Ctrl + C` in the terminal to stop.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the matcher unit tests and benchmark |
| `npm run build` | Builds the production frontend into `web/dist` |
| `npm run preview` | Serves the production build (with the mock API) at http://localhost:4173 |
| `npm run typecheck` | Type-checks all TypeScript |

The mock API keeps everything in memory, so restarting `npm run dev` resets today's Daily,
results, and seen questions. That's handy for testing.

## Layout

```
/web      frontend (React + Vite + Framer Motion); web/mock = Phase 1 mock API
/worker   API + Durable Objects (Phase 3+)
/shared   types, config, matcher (used by web, worker, and scripts)
/content  question data
/scripts  seed, validate, import, status, export:rejected, pool:refresh (Phase 2+)
```

All tunable settings (app name, tier points, timer length, penalties, zone depths, Daily reset
time zone, party defaults) live in `shared/src/config.ts`.
