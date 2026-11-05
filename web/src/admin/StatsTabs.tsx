import { useCallback, useEffect, useMemo, useState } from "react";
import { tierInfo } from "@fathom/shared";
import type { TierPoints } from "@fathom/shared";
import { admin } from "./adminApi";

/* ------------------------------------------------------------------------- */
/* Players: who played in a time frame, and what they did                    */
/* ------------------------------------------------------------------------- */

interface PlayersData {
  from: string;
  to: string;
  totals: { activePlayers: number; newPlayers: number; withAccounts: number; dailies: number; unlimitedRuns: number; quickRuns: number; partyGames: number; abyss: number };
  players: {
    id: string;
    nickname: string | null;
    username: string | null;
    joined: number;
    lastActive: number;
    dailies: number;
    dailyAvg: number | null;
    unlimitedRuns: number;
    quickRuns: number;
    partyGames: number;
    partyWins: number;
    abyss: number;
  }[];
}
interface PlayerDetail {
  id: string;
  nickname: string | null;
  username: string | null;
  friendCode: string | null;
  joined: number;
  activity: { at: number; what: string }[];
}

const isoDay = (offset = 0) => new Date(Date.now() - 7 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const when = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export function PlayersTab() {
  const [from, setFrom] = useState(isoDay(-6));
  const [to, setTo] = useState(isoDay());
  const [data, setData] = useState<PlayersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PlayerDetail | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await admin<PlayersData>(`/api/admin/players?from=${from}&to=${to}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  const preset = (days: number) => {
    setFrom(isoDay(-(days - 1)));
    setTo(isoDay());
  };
  const rows = useMemo(
    () =>
      (data?.players ?? []).filter((p) => !filter || `${p.nickname ?? ""} ${p.username ?? ""}`.toLowerCase().includes(filter.toLowerCase())),
    [data, filter],
  );

  return (
    <div>
      <div className="admin-row">
        <label>
          From <input type="date" className="admin-input admin-input--date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="date" className="admin-input admin-input--date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn" onClick={() => preset(1)}>
          Today
        </button>
        <button className="btn" onClick={() => preset(7)}>
          Last 7 days
        </button>
        <button className="btn" onClick={() => preset(30)}>
          Last 30 days
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="admin-stat-cards">
            <Stat label="Active players" value={data.totals.activePlayers} />
            <Stat label="New players" value={data.totals.newPlayers} />
            <Stat label="With accounts" value={data.totals.withAccounts} />
            <Stat label="Dailies played" value={data.totals.dailies} />
            <Stat label="Unlimited dives" value={data.totals.unlimitedRuns} />
            <Stat label="Quick-mode runs" value={data.totals.quickRuns} />
            <Stat label="Party games" value={data.totals.partyGames} />
            <Stat label="Abyss dives" value={data.totals.abyss} />
          </div>
          <input className="admin-input" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <table className="admin-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Last active</th>
                <th>Dailies</th>
                <th>Daily avg</th>
                <th>Unlimited</th>
                <th>Quick</th>
                <th>Party (wins)</th>
                <th>Abyss</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="admin-click-row" onClick={async () => setOpen(await admin<PlayerDetail>(`/api/admin/player/${encodeURIComponent(p.id)}`))}>
                  <td>
                    {p.nickname ?? <span className="muted">guest</span>}
                    {p.username && <span className="muted small"> @{p.username}</span>}
                  </td>
                  <td>{when(p.lastActive)}</td>
                  <td>{p.dailies || ""}</td>
                  <td>{p.dailyAvg !== null ? `${p.dailyAvg.toLocaleString()} m` : ""}</td>
                  <td>{p.unlimitedRuns || ""}</td>
                  <td>{p.quickRuns || ""}</td>
                  <td>{p.partyGames ? `${p.partyGames} (${p.partyWins})` : ""}</td>
                  <td>{p.abyss || ""}</td>
                  <td className="muted small">{when(p.joined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="muted">Nobody played in this time frame.</p>}
        </>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(null)}>
          <div className="card modal admin-player-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {open.nickname ?? "Guest"} {open.username && <span className="muted small">@{open.username}</span>}
            </h3>
            <p className="muted small">
              Joined {when(open.joined)}
              {open.friendCode ? ` · friend code ${open.friendCode}` : ""}
            </p>
            <ul className="admin-activity">
              {open.activity.map((a, i) => (
                <li key={i}>
                  <span className="muted small">{when(a.at)}</span> {a.what}
                </li>
              ))}
              {open.activity.length === 0 && <li className="muted">No activity yet.</li>}
            </ul>
            <button className="btn" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-stat">
      <b>{value.toLocaleString()}</b>
      <span className="muted small">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Dailies: how people did on recent Dailies, question by question            */
/* ------------------------------------------------------------------------- */

interface DailySummary {
  date: string;
  divers: number;
  avgDepth: number | null;
  prompts: { id: string; prompt: string; category: string }[];
}
interface DailyDetail {
  date: string;
  divers: number;
  avgDepth: number | null;
  histogram: { depth: number; n: number }[];
  questions: {
    id: string;
    prompt: string;
    category: string;
    plays: number;
    successRate: number | null;
    avgPoints: number | null;
    avgSeconds: number | null;
    tiers: Record<string, number>;
    topAnswers: { answer: string; n: number }[];
    wrongGuesses: { guess: string; n: number }[];
  }[];
}

const TIER_ORDER = ["100", "85", "60", "30", "15", "10", "miss"];

export function DailiesTab({ onDelete }: { onDelete: (id: string, prompt: string) => Promise<void> }) {
  const [list, setList] = useState<DailySummary[]>([]);
  const [detail, setDetail] = useState<DailyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    admin<DailySummary[]>("/api/admin/dailies?days=21")
      .then(setList)
      .catch((e) => setError((e as Error).message));
  }, []);
  const open = async (date: string) => {
    setError(null);
    try {
      setDetail(await admin<DailyDetail>(`/api/admin/daily/${date}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      {error && <p className="error-text">{error}</p>}
      {!detail ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Divers</th>
              <th>Avg depth</th>
              <th>Questions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.date} className="admin-click-row" onClick={() => void open(d.date)}>
                <td>
                  <b>{d.date}</b>
                </td>
                <td>{d.divers}</td>
                <td>{d.avgDepth !== null ? `${d.avgDepth.toLocaleString()} m` : "—"}</td>
                <td className="small">{d.prompts.map((p) => p.prompt).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div>
          <button className="btn" onClick={() => setDetail(null)}>
            ← All Dailies
          </button>
          <h3>
            Daily {detail.date}: {detail.divers} diver{detail.divers === 1 ? "" : "s"}
            {detail.avgDepth !== null && <span className="muted"> · average {detail.avgDepth.toLocaleString()} m</span>}
          </h3>
          <Histogram rows={detail.histogram} />
          {detail.questions.map((q, i) => (
            <div key={q.id} className={`card admin-daily-q${q.successRate !== null && q.successRate < 40 ? " admin-daily-q--hard" : ""}`}>
              <div className="admin-row">
                <b>
                  {i + 1}. {q.prompt}
                </b>
                <span className="muted small">
                  {q.category} · {q.id}
                </span>
              </div>
              <div className="admin-row small">
                <span>
                  Success <b>{q.successRate ?? "—"}%</b>
                </span>
                <span>
                  Avg points <b>{q.avgPoints ?? "—"}</b>
                </span>
                <span>
                  Avg time <b>{q.avgSeconds ?? "—"}s</b>
                </span>
                <span>
                  Plays <b>{q.plays}</b>
                </span>
              </div>
              <div className="admin-tierbar" title="How answers split across tiers">
                {TIER_ORDER.filter((t) => q.tiers[t]).map((t) => (
                  <span
                    key={t}
                    style={{ flex: q.tiers[t], background: t === "miss" ? "#555" : tierInfo(Number(t) as TierPoints).color }}
                    title={`${t === "miss" ? "Missed" : tierInfo(Number(t) as TierPoints).name}: ${q.tiers[t]}`}
                  />
                ))}
              </div>
              <div className="admin-two-col small">
                <div>
                  <b>Top answers</b>
                  <ol>
                    {q.topAnswers.map((a) => (
                      <li key={a.answer}>
                        {a.answer} <span className="muted">×{a.n}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <b>Common wrong guesses</b>
                  <ol>
                    {q.wrongGuesses.map((w) => (
                      <li key={w.guess}>
                        {w.guess} <span className="muted">×{w.n}</span>
                      </li>
                    ))}
                    {q.wrongGuesses.length === 0 && <li className="muted">None</li>}
                  </ol>
                </div>
              </div>
              <button className="link-btn admin-danger" onClick={() => void onDelete(q.id, q.prompt)}>
                Delete this question (it won't appear in Unlimited)
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Histogram({ rows }: { rows: { depth: number; n: number }[] }) {
  if (!rows.length) return <p className="muted">No finished dives yet.</p>;
  // Group into 500 m buckets so the shape is readable.
  const buckets = new Map<number, number>();
  for (const r of rows) buckets.set(Math.floor(r.depth / 500) * 500, (buckets.get(Math.floor(r.depth / 500) * 500) ?? 0) + r.n);
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const max = Math.max(...buckets.values());
  return (
    <div className="admin-hist">
      {keys.map((k) => (
        <div key={k} className="admin-hist-col" title={`${k.toLocaleString()}–${(k + 499).toLocaleString()} m: ${buckets.get(k)}`}>
          <span style={{ height: `${(buckets.get(k)! / max) * 100}%` }} />
          <small>{k / 1000}k</small>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Struggling questions (shown at the top of the Questions tab)               */
/* ------------------------------------------------------------------------- */

interface Struggling {
  days: number;
  minPlays: number;
  recentDailies: { id: string; prompt: string; category: string; dailyDate: string | null; plays: number; successRate: number; avgPoints: number }[];
  allQuestions: { id: string; prompt: string; category: string; status: string; plays: number; successRate: number; avgPoints: number }[];
}

export function StrugglingPanel({ onDelete, reloadKey }: { onDelete: (id: string, prompt: string) => Promise<void>; reloadKey: number }) {
  const [data, setData] = useState<Struggling | null>(null);
  useEffect(() => {
    admin<Struggling>("/api/admin/struggling?days=21&min=15")
      .then(setData)
      .catch(() => setData(null));
  }, [reloadKey]);
  if (!data) return null;
  const rows = [...data.recentDailies.map((q) => ({ ...q, where: `Daily ${q.dailyDate ?? ""}` }))];
  for (const q of data.allQuestions) if (!rows.some((r) => r.id === q.id)) rows.push({ ...q, dailyDate: null, where: q.status === "scheduled" ? "Daily (aired)" : "Unlimited" });
  const worst = rows.filter((r) => r.successRate < 50).slice(0, 20);
  return (
    <div className="card admin-struggling">
      <h3>Questions players struggle with</h3>
      <p className="muted small">
        Lowest success rates (at least {data.minPlays} plays; Dailies from the last {data.days} days). Hard is fine; delete the ones that feel unfair.
      </p>
      {worst.length === 0 ? (
        <p className="muted">Nothing below 50% success. 🎉</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Question</th>
              <th>Where</th>
              <th>Success</th>
              <th>Avg pts</th>
              <th>Plays</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {worst.map((q) => (
              <tr key={q.id}>
                <td>{q.prompt}</td>
                <td className="small">{q.where}</td>
                <td>
                  <b>{q.successRate}%</b>
                </td>
                <td>{q.avgPoints}</td>
                <td>{q.plays}</td>
                <td>
                  <button className="link-btn admin-danger" onClick={() => void onDelete(q.id, q.prompt)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
