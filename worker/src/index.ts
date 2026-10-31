import { Hono } from "hono";
import type { Context } from "hono";
import { HttpError } from "./env";
import type { Env } from "./env";
import { adminRoutes } from "./admin";
import { leaderboardRoutes } from "./leaderboards";
import { roomRoutes } from "./rooms";
import { categories, finish, getDaily, guess, nextQuestion, report, reveal, sessionState, startSession } from "./solo";
import { playerStats } from "./stats";
import { friendRoutes } from "./social";
import { suggestionRoutes } from "./suggestions";

export { Room } from "./room";

type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();

/** Anonymous player ID from localStorage, sent on every request. */
export function playerIdOf(c: Context<AppEnv>): string {
  const id = c.req.header("X-Player-Id") ?? "";
  if (!/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, "Missing or invalid player id");
  return id;
}

async function body<T>(c: Context<AppEnv>): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status as 400);
  console.error(err);
  return c.json({ error: "Server error" }, 500);
});

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.get("/api/health", (c) => c.json({ ok: true, serverNow: Date.now() }));
app.get("/api/daily", async (c) => c.json(await getDaily(c.env, playerIdOf(c), Date.now())));
app.get("/api/categories", async (c) => c.json(await categories(c.env, Date.now())));
app.post("/api/session/start", async (c) => c.json(await startSession(c.env, playerIdOf(c), await body(c), Date.now())));
app.get("/api/session/:id", async (c) => c.json(await sessionState(c.env, playerIdOf(c), c.req.param("id"), Date.now())));
app.post("/api/session/:id/next", async (c) => c.json(await nextQuestion(c.env, playerIdOf(c), c.req.param("id"), Date.now())));
app.post("/api/session/:id/guess", async (c) =>
  c.json(await guess(c.env, playerIdOf(c), c.req.param("id"), await body(c), Date.now())),
);
app.get("/api/session/:id/reveal/:index", async (c) =>
  c.json(await reveal(c.env, playerIdOf(c), c.req.param("id"), Number(c.req.param("index")), Date.now())),
);
app.post("/api/session/:id/finish", async (c) => c.json(await finish(c.env, playerIdOf(c), c.req.param("id"), Date.now())));
app.get("/api/stats/me", async (c) => c.json(await playerStats(c.env, playerIdOf(c), Date.now())));
app.post("/api/report", async (c) => c.json(await report(c.env, playerIdOf(c), await body(c), Date.now())));

app.route("/", adminRoutes);
app.route("/", leaderboardRoutes);
app.route("/", roomRoutes);
app.route("/", friendRoutes);
app.route("/", suggestionRoutes);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Everything else is the website (static assets, SPA fallback to index.html).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
