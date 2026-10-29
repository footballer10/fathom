import { useEffect, useState } from "react";
import { MISS_EMOJI, formatDepth, tierInfo } from "@krillion/shared";
import type { TierPoints } from "@krillion/shared";
import { api } from "../api";
import type { LeaderboardRow, PlayerStats, Profile } from "../api";
import { NicknamePrompt, getNickname } from "../nickname";
import { navigate } from "../router";

/** Streaks, averages and a histogram of Daily depths. */
export function StatsPanel() {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
  }, []);
  if (!stats || stats.played === 0) return null;
  const buckets = Object.entries(stats.histogram);
  const max = Math.max(1, ...buckets.map(([, n]) => n));
  return (
    <div className="card stats-card">
      <h3>Your Daily stats</h3>
      <div className="stats-row">
        <Stat label="Played" value={stats.played} />
        <Stat label="Streak" value={stats.currentStreak} />
        <Stat label="Best streak" value={stats.bestStreak} />
        <Stat label="Average" value={formatDepth(stats.averageDepth)} />
        <Stat label="Deepest" value={formatDepth(stats.bestDepth)} />
      </div>
      <div className="muted small">Your Daily answers by tier</div>
      <div className="histogram" aria-label="Answers by tier">
        {buckets.map(([label, n]) => (
          <div key={label} className="histo-col" title={`${label === "miss" ? "Miss" : tierInfo(Number(label) as TierPoints).name}: ${n}`}>
            <div className="histo-n small">{n}</div>
            <div className="histo-bar" style={{ height: `${(n / max) * 100}%` }} />
            <div className="histo-label">{label === "miss" ? MISS_EMOJI : tierInfo(Number(label) as TierPoints).emoji}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label muted small">{label}</div>
    </div>
  );
}

/** Today's Daily depths for you and the friends you've added by code. */
export function FriendsPage() {
  const [nickname, setNickname] = useState<string | null>(getNickname());
  const [data, setData] = useState<{ dailyNumber: number; me: Profile; rows: LeaderboardRow[] } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.leaderboard().then(setData).catch((e) => setMsg((e as Error).message));
  useEffect(() => {
    if (nickname) void load();
  }, [nickname]);

  if (!nickname) return <NicknamePrompt onDone={setNickname} title="Pick a nickname for the friends board" />;

  const add = async () => {
    setMsg(null);
    try {
      const r = await api.addFriend(code.trim().toUpperCase());
      setMsg(`Added ${r.nickname ?? "your friend"}!`);
      setCode("");
      void load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="friends">
      <h1 className="title">Friends</h1>
      <div className="card">
        <p>
          Your friend code: <b className="big-code small-code">{data?.me.friendCode ?? "…"}</b>
        </p>
        <p className="muted small">Share it with friends. When they add it, you'll see each other's Daily depths here.</p>
        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input className="code-input code-input--wide" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Friend's code" />
          <button className="btn" type="submit" disabled={!code.trim()}>
            Add
          </button>
        </form>
        {msg && <p className="muted small">{msg}</p>}
      </div>
      <div className="card">
        <h3>Daily #{data?.dailyNumber ?? "…"}</h3>
        <ol className="leaderboard">
          {data?.rows.map((r) => (
            <li key={r.friendCode} className={r.you ? "me" : ""}>
              <span className="lb-name">{r.nickname}</span>
              <span className="lb-tiers">
                {r.tiers ? r.tiers.map((t, i) => <span key={i}>{t ? tierInfo(t as TierPoints).emoji : "⬛"}</span>) : <span className="muted small">not played yet</span>}
              </span>
              <span className="lb-depth">{r.depth === null ? "—" : formatDepth(r.depth)}</span>
              <span className="muted small" title="Total this week">{formatDepth(r.weekDepth)} wk</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Replay past Dailies for fun (not scored). */
export function ArchivePage({ onPlay }: { onPlay: (date: string) => void }) {
  const [days, setDays] = useState<{ date: string; dailyNumber: number; depth: number | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.archive().then(setDays).catch((e) => setError((e as Error).message));
  }, []);
  return (
    <div className="archive">
      <h1 className="title">Archive</h1>
      <p className="tagline">Replay any past Daily. Archive runs don't count toward stats or streaks.</p>
      {error && <p className="error-text">{error}</p>}
      {days && days.length === 0 && <p className="center muted">No past Dailies yet. Come back tomorrow!</p>}
      <ul className="archive-list">
        {days?.map((d) => (
          <li key={d.date} className="card archive-item">
            <span>
              <b>Daily #{d.dailyNumber}</b> <span className="muted small">{d.date}</span>
            </span>
            <span className="muted small">{d.depth === null ? "not played" : formatDepth(d.depth)}</span>
            <button className="btn" onClick={() => onPlay(d.date)}>
              Play
            </button>
          </li>
        ))}
      </ul>
      <div className="center">
        <button className="link-btn" onClick={() => navigate("/")}>
          ← Back
        </button>
      </div>
    </div>
  );
}
