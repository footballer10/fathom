import { useEffect, useMemo, useState } from "react";
import { MISS_EMOJI, TIERS, formatDepth, tierInfo, zoneForDepth } from "@fathom/shared";
import type { TierPoints } from "@fathom/shared";
import { getPlayerId } from "../player";
import { navigate } from "../router";

/**
 * Your logbook: a calendar of every Daily you've dived (tap a day to see your
 * answers), your rarest finds, lifetime numbers and how your answers spread
 * across the tiers.
 */

interface LogbookData {
  totals: {
    dailies: number;
    unlimited: number;
    answers: number;
    krillions: number;
    deepCuts: number;
    bestDaily: number;
    bestUnlimited: number;
    bestStreak: number;
    partyGames: number;
    partyWins: number;
    bestSprint: number;
    bestLadder: number;
    bestRoulette: number;
    bestFive: number;
    pearls: number;
  };
  tiers: Record<string, number>;
  dailies: { date: string; number: number; depth: number; tiers: (number | null)[] }[];
  finds: { canonical: string; tier: number; prompt: string; mode: string; date: string | null; at: number }[];
}

interface DayData {
  date: string;
  number: number;
  plays: { prompt: string; canonical: string | null; tier: number | null; points: number; seconds: number }[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "X-Player-Id": getPlayerId() } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const emoji = (t: number | null) => (t ? tierInfo(t as TierPoints).emoji : MISS_EMOJI);

/** Colour for a day on the calendar: deeper dives are darker blue. */
function depthColor(depth: number) {
  const t = Math.min(1, depth / 5000);
  return `hsl(${200 - t * 30} ${70 + t * 10}% ${62 - t * 38}%)`;
}

function monthLabel(y: number, m: number) {
  return new Date(Date.UTC(y, m, 15)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function Calendar({ days, onPick, picked }: { days: Map<string, LogbookData["dailies"][number]>; onPick: (date: string) => void; picked: string | null }) {
  const latest = [...days.keys()].sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const [view, setView] = useState(() => ({ y: Number(latest.slice(0, 4)), m: Number(latest.slice(5, 7)) - 1 }));
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`)];
  const step = (d: number) => setView((v) => ({ y: v.y + Math.floor((v.m + d) / 12), m: (((v.m + d) % 12) + 12) % 12 }));
  const played = cells.filter((c) => c && days.has(c)).length;
  return (
    <div className="logbook-cal">
      <div className="logbook-cal-head">
        <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous month">
          ‹
        </button>
        <b>{monthLabel(view.y, view.m)}</b>
        <button className="icon-btn" onClick={() => step(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="logbook-cal-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="logbook-cal-dow">
            {d}
          </span>
        ))}
        {cells.map((c, i) => {
          if (!c) return <span key={i} />;
          const d = days.get(c);
          return d ? (
            <button
              key={c}
              className={`logbook-day logbook-day--played ${picked === c ? "logbook-day--picked" : ""}`}
              style={{ background: depthColor(d.depth) }}
              onClick={() => onPick(c)}
              title={`Daily #${d.number}: ${formatDepth(d.depth)}`}
            >
              {Number(c.slice(8))}
            </button>
          ) : (
            <span key={c} className="logbook-day">
              {Number(c.slice(8))}
            </span>
          );
        })}
      </div>
      <p className="muted small center">
        {played} Dail{played === 1 ? "y" : "ies"} this month. Darker days went deeper. Tap one to see your answers.
      </p>
    </div>
  );
}

export function LogbookPage() {
  const [data, setData] = useState<LogbookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    get<LogbookData>("/api/logbook").then(setData).catch((e) => setError(e.message));
  }, []);

  const days = useMemo(() => new Map((data?.dailies ?? []).map((d) => [d.date, d])), [data]);

  const pick = (date: string) => {
    setPicked(date);
    setDay(null);
    get<DayData>(`/api/logbook/day/${date}`).then(setDay).catch((e) => setError(e.message));
  };

  if (error && !data) return <p className="error-text center">{error}</p>;
  if (!data) return <div className="card center">Opening your logbook…</div>;
  const t = data.totals;
  const tierTotal = Object.values(data.tiers).reduce((a, b) => a + b, 0);
  const avg = data.dailies.length ? Math.round(data.dailies.reduce((n, d) => n + d.depth, 0) / data.dailies.length) : 0;

  return (
    <div className="logbook">
      <div className="page-head">
        <h2>📖 Logbook</h2>
      </div>

      {data.dailies.length === 0 && t.unlimited === 0 ? (
        <div className="card center">
          <p>Your logbook is empty for now. Every dive you take gets written down here.</p>
          <button className="btn btn--primary" onClick={() => navigate("/")}>
            Go dive
          </button>
        </div>
      ) : (
        <>
          <div className="logbook-stats">
            <Stat label="Dailies" value={t.dailies} />
            <Stat label="Average Daily" value={formatDepth(avg)} />
            <Stat label="Deepest Daily" value={formatDepth(t.bestDaily)} sub={t.bestDaily ? zoneForDepth(t.bestDaily).name : undefined} />
            <Stat label="Best streak" value={`${t.bestStreak} days`} />
            <Stat label="Unlimited dives" value={t.unlimited} />
            <Stat label="One in a Krillion" value={t.krillions} />
            <Stat label="Deep Cut or rarer" value={t.deepCuts} />
            <Stat label="Party wins" value={`${t.partyWins} / ${t.partyGames}`} />
            <Stat label="Pearls earned" value={t.pearls.toLocaleString("en-US")} />
          </div>

          {data.dailies.length > 0 && (
            <div className="card">
              <h3>Your Dailies</h3>
              <Calendar days={days} onPick={pick} picked={picked} />
              {picked && (
                <div className="logbook-dayview">
                  {!day ? (
                    <p className="muted center">Loading…</p>
                  ) : (
                    <>
                      <h4>
                        Daily #{day.number} · {formatDepth(day.plays.reduce((n, p) => n + p.points, 0) * 10)}
                      </h4>
                      <ol className="logbook-plays">
                        {day.plays.map((p, i) => (
                          <li key={i}>
                            <span className="logbook-play-emoji">{emoji(p.tier)}</span>
                            <span className="logbook-play-prompt">{p.prompt}</span>
                            <span className="logbook-play-answer">
                              {p.canonical ?? <span className="muted">no answer</span>}
                              {p.tier ? <span className="muted small"> · {tierInfo(p.tier as TierPoints).name}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {data.finds.length > 0 && (
            <div className="card">
              <h3>Rarest finds</h3>
              <ul className="logbook-finds">
                {data.finds.map((f, i) => (
                  <li key={i} style={{ "--tier": tierInfo(f.tier as TierPoints).color } as React.CSSProperties}>
                    <span className="logbook-find-emoji">{emoji(f.tier)}</span>
                    <span className="logbook-find-answer">{f.canonical}</span>
                    <span className="muted small logbook-find-prompt">
                      {f.prompt}
                      {f.date && f.mode === "daily" ? ` · ${f.date}` : ` · ${f.mode}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tierTotal > 0 && (
            <div className="card">
              <h3>Your answers by tier</h3>
              <ul className="logbook-tiers">
                {[...TIERS].reverse().map((tier) => {
                  const n = data.tiers[String(tier.points)] ?? 0;
                  return (
                    <li key={tier.points} style={{ "--tier": tier.color } as React.CSSProperties}>
                      <span className="logbook-tier-name">
                        {tier.emoji} {tier.name}
                      </span>
                      <span className="logbook-tier-bar">
                        <span style={{ width: `${(n / tierTotal) * 100}%` }} />
                      </span>
                      <span className="logbook-tier-n">{n}</span>
                    </li>
                  );
                })}
                <li style={{ "--tier": "#7a8a99" } as React.CSSProperties}>
                  <span className="logbook-tier-name">{MISS_EMOJI} Missed</span>
                  <span className="logbook-tier-bar">
                    <span style={{ width: `${((data.tiers.miss ?? 0) / tierTotal) * 100}%` }} />
                  </span>
                  <span className="logbook-tier-n">{data.tiers.miss ?? 0}</span>
                </li>
              </ul>
            </div>
          )}

          {(t.bestSprint || t.bestLadder || t.bestRoulette || t.bestFive) > 0 && (
            <div className="card">
              <h3>Quick-mode bests</h3>
              <div className="logbook-stats">
                <Stat label="Sprint" value={formatDepth(t.bestSprint * 10)} />
                <Stat label="Ladder" value={`${t.bestLadder} rungs`} />
                <Stat label="Rarity Roulette" value={`${t.bestRoulette} hits`} />
                <Stat label="Five Answers" value={formatDepth(t.bestFive * 10)} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="logbook-stat">
      <span className="logbook-stat-value">{value}</span>
      <span className="muted small">{label}</span>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}
