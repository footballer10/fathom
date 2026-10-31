import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { APP_NAME, QUESTION_SECONDS, TIERS } from "@fathom/shared";
import type { Category } from "@fathom/shared";
import { api } from "../api";
import type { DailyStatus } from "../api";
import { navigate } from "../router";
import { StatsPanel } from "./Social";

export function Home({
  onPlay,
  reducedMotion,
}: {
  onPlay: (mode: "daily" | "unlimited", category?: Category) => void;
  reducedMotion: boolean;
}) {
  const [daily, setDaily] = useState<DailyStatus | null>(null);
  const [categories, setCategories] = useState<{ category: Category; count: number }[]>([]);
  const [category, setCategory] = useState<Category | "">("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.daily().then(setDaily).catch((e) => setError(e.message));
    api.categories().then(setCategories).catch(() => {});
  }, []);

  const dailyLabel =
    daily?.status === "finished" ? "See today's results" : daily?.status === "in-progress" ? "Resume the Daily" : "Dive the Daily";

  return (
    <motion.div
      className="home"
      initial={reducedMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="title">{APP_NAME}</h1>
      <p className="tagline">Name something. The rarer your answer, the deeper you dive.</p>

      <div className="mode-cards">
        <div className="card mode-card">
          <div className="mode-card-head">
            <span className="mode-card-emoji" aria-hidden>📅</span>
            <h3>Daily{daily ? ` #${daily.dailyNumber}` : ""}</h3>
            <span className="muted">Same 7 prompts for everyone</span>
          </div>
          <p className="muted small">One scored dive per day. Resets at midnight Mountain time.</p>
          <button className="btn btn--primary" onClick={() => onPlay("daily")} disabled={!daily}>
            {dailyLabel}
          </button>
        </div>

        <div className="card mode-card">
          <div className="mode-card-head">
            <span className="mode-card-emoji" aria-hidden>♾️</span>
            <h3>Unlimited</h3>
            <span className="muted">7 prompts at a time, and you never see the same one twice</span>
          </div>
          <label className="select-label">
            <span className="muted small">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.category} value={c.category}>
                  {c.category.replace("-", " & ")} ({c.count})
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => onPlay("unlimited", category || undefined)}>
            Start a dive
          </button>
        </div>

        <div className="card mode-card mode-card--party">
          <div className="mode-card-head">
            <span className="mode-card-emoji" aria-hidden>🎉</span>
            <h3>Party</h3>
            <span className="muted">Play live with friends</span>
          </div>
          <p className="muted small">Group Dive races everyone on the same prompts. Battle passes the pufferfish until one diver is left.</p>
          <button className="btn btn--party" onClick={() => navigate("/party")}>
            Start or join a party
          </button>
        </div>
      </div>

      <nav className="home-nav">
        <button className="btn btn--ghost" onClick={() => navigate("/leaderboards")}>
          🏆 Leaderboards
        </button>
        <button className="btn btn--ghost" onClick={() => navigate("/friends")}>
          🐠 Friends board
        </button>
        <button className="btn btn--ghost" onClick={() => navigate("/archive")}>
          🗓️ Archive
        </button>
      </nav>

      {error && <p className="error-text">Couldn't reach the game server: {error}</p>}

      <StatsPanel />

      <div className="card how">
        <h3>How to play</h3>
        <p className="muted small">
          Type one valid answer within {QUESTION_SECONDS} seconds. Wrong guesses are free,
          so keep trying. Every point sinks you 10 meters.
        </p>
        <ul className="tier-legend">
          {[...TIERS].reverse().map((t) => (
            <li key={t.points} style={{ "--tier": t.color } as React.CSSProperties}>
              <span className="tier-emoji">{t.emoji}</span>
              <span className="tier-name">{t.name}</span>
              <span className="tier-pts">{t.points}</span>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}
