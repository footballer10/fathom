import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DAILY_DEPTH_MEAN, ITEM_BY_ID, DAILY_DEPTH_SD, MISS_EMOJI, PERCENTILE_MIN_RESULTS, formatDepth, shareCardText, tierInfo } from "@fathom/shared";
import type { FinishResponse, RevealResponse, TierPoints } from "@fathom/shared";
import { api, serverNow } from "../api";
import { RevealPanel } from "./RevealPanel";
import { PearlCount } from "./RewardsPages";
import { PlayerName } from "./Cosmetics";
import { TapName } from "./PlayerCardHost";
import { quietRefresh } from "../rewards";
import { navigate } from "../router";

function useCountdown(target: number) {
  const [left, setLeft] = useState(() => Math.max(0, target - serverNow()));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, target - serverNow())), 1000);
    return () => clearInterval(id);
  }, [target]);
  const s = Math.floor(left / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function EndScreen({
  result,
  sessionId,
  reducedMotion,
  onHome,
  onPlayUnlimited,
}: {
  result: FinishResponse;
  sessionId: string;
  reducedMotion: boolean;
  onHome: () => void;
  onPlayUnlimited: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Pick up the pearls this dive paid (already listed here, so no extra toast).
  useEffect(() => void quietRefresh(), []);
  const [open, setOpen] = useState<number | null>(null);
  const [reveals, setReveals] = useState<Record<number, RevealResponse>>({});
  const countdown = useCountdown(result.nextDailyAt);
  const share = shareCardText({
    dailyNumber: result.dailyNumber,
    totalPoints: result.totalPoints,
    tiers: result.plays.map((p) => p.tier),
  });

  const toggle = async (index: number) => {
    setOpen((o) => (o === index ? null : index));
    if (!reveals[index]) {
      const r = await api.reveal(sessionId, index).catch(() => null);
      if (r) setReveals((m) => ({ ...m, [index]: r }));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share);
    } catch {
      // Fallback for browsers that block the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = share;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const fade = (delay: number) =>
    reducedMotion ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.45 } };

  return (
    <div className="end">
      <motion.div className="card end-hero" {...fade(0)}>
        <div className="muted small">{result.mode === "daily" ? `Daily #${result.dailyNumber}` : "Unlimited dive"}</div>
        <div className="end-depth">{formatDepth(result.depth)}</div>
        <div className="end-zone">{result.zone}</div>
        <div className="muted small">{result.totalPoints} points</div>
        {result.mode === "daily" && <DailyCurve depth={result.depth} actual={result.percentile} divers={result.divers ?? null} reducedMotion={reducedMotion} />}
      </motion.div>

      {result.earned && result.earned.pearls > 0 && (
        <motion.div className="card end-earned" {...fade(0.1)}>
          <div className="end-earned-total">
            <PearlCount n={result.earned.pearls} big /> <span>pearls earned</span>
          </div>
          <ul className="end-earned-lines">
            {result.earned.lines.map((l, i) => (
              <li key={i}>
                {l.label} <b>+{l.pearls}</b>
              </li>
            ))}
            {result.earned.items.map((id) => (
              <li key={id} className="end-earned-item">
                🎁 Unlocked: <b>{ITEM_BY_ID.get(id)?.name ?? id}</b>
              </li>
            ))}
          </ul>
          <div className="end-earned-btns">
            <button className="btn btn--small" onClick={() => navigate("/quests")}>
              📜 Quests
            </button>
            <button className="btn btn--small" onClick={() => navigate("/shop")}>
              🛍️ Shop
            </button>
          </div>
        </motion.div>
      )}

      <motion.div className="card" {...fade(0.15)}>
        <h3>Your answers</h3>
        <ul className="end-plays">
          {result.plays.map((p) => {
            const info = p.tier ? tierInfo(p.tier) : null;
            return (
              <li key={p.index}>
                <button className="end-play" onClick={() => void toggle(p.index)} aria-expanded={open === p.index}>
                  <span className="end-play-emoji">{info?.emoji ?? MISS_EMOJI}</span>
                  <span className="end-play-prompt">{p.prompt}</span>
                  <span className="end-play-answer" style={{ color: info?.color }}>
                    {p.canonical ?? "—"}
                  </span>
                  <span className="end-play-pts">{p.points}</span>
                </button>
                {open === p.index &&
                  (reveals[p.index] ? <RevealPanel reveal={reveals[p.index]} compact /> : <div className="loading small">Loading…</div>)}
              </li>
            );
          })}
        </ul>
        <p className="muted small">Click a question to see every valid answer.</p>
      </motion.div>

      <motion.div className="end-row" {...fade(0.3)}>
        {result.rarestToday && (
          <div className="card end-mini">
            <div className="muted small">{result.mode === "daily" ? "Rarest answer anyone gave today" : "Your rarest find"}</div>
            <div className="end-mini-big">
              {tierInfo(result.rarestToday.tier).emoji} {result.rarestToday.canonical}
            </div>
            <div className="muted small">
              {result.rarestToday.prompt} · {tierInfo(result.rarestToday.tier).name}
            </div>
          </div>
        )}
        <div className="card end-mini">
          <div className="muted small">Next Daily in</div>
          <div className="end-mini-big mono">{countdown}</div>
        </div>
      </motion.div>

      <motion.div className="card share" {...fade(0.45)}>
        <h3>Share</h3>
        <pre className="share-card">{share}</pre>
        <button className="btn btn--primary" onClick={() => void copy()}>
          {copied ? "Copied!" : "Copy to clipboard"}
        </button>
      </motion.div>

      {result.mode === "daily" && result.date && <DailyTop date={result.date} dailyNumber={result.dailyNumber} fade={fade(0.5)} />}

      <motion.div className="end-actions" {...fade(0.55)}>
        <button className="btn" onClick={onPlayUnlimited}>
          Play Unlimited
        </button>
        <button className="btn btn--ghost" onClick={onHome}>
          Return to the surface
        </button>
      </motion.div>
    </div>
  );
}

type DailyTopData = Awaited<ReturnType<typeof api.dailyTop>>;

/** Today's top divers on the Daily (named players), with your own place if you're further down. */
function DailyTop({ date, dailyNumber, fade }: { date: string; dailyNumber: number | null; fade: object }) {
  const [data, setData] = useState<DailyTopData | null>(null);
  useEffect(() => {
    api
      .dailyTop(date)
      .then(setData)
      .catch(() => {});
  }, [date]);
  if (!data || !data.rows.length) return null;
  return (
    <motion.div className="card daily-top" {...fade}>
      <h3>Top divers on Daily{dailyNumber ? ` #${dailyNumber}` : ""}</h3>
      <p className="muted small">
        {data.divers.toLocaleString()} {data.divers === 1 ? "diver" : "divers"} so far today · only players with a name appear
      </p>
      <ol className="standings-list">
        {data.rows.map((r) => (
          <li key={`${r.rank}-${r.nickname}`} className={`${r.you ? "me" : ""}${r.rank === 1 ? " standings-first" : ""}`}>
            <span className="standings-rank">{["🥇", "🥈", "🥉"][r.rank - 1] ?? r.rank}</span>
            <span className="standings-name">
              <TapName name={r.nickname} code={r.code} look={r.look} you={r.you}>
                <PlayerName name={r.nickname} look={r.look} inline>
                  {r.you && <span className="player-tag player-tag--you">you</span>}
                </PlayerName>
              </TapName>
            </span>
            <span className="daily-top-tiers" aria-hidden>
              {r.tiers.map((t, i) => (
                <span key={i}>{t ? tierInfo(t as TierPoints).emoji : MISS_EMOJI}</span>
              ))}
            </span>
            <span className="standings-stat">{formatDepth(r.depth)}</span>
          </li>
        ))}
        {data.you && (
          <li className="me">
            <span className="standings-rank">{data.you.rank}</span>
            <span className="standings-name">
              You <span className="muted small">(add a name in Settings to show up)</span>
            </span>
            <span className="standings-stat">{formatDepth(data.you.depth)}</span>
          </li>
        )}
      </ol>
    </motion.div>
  );
}


/** Standard normal CDF (Abramowitz–Stegun erf approximation, plenty accurate here). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Where your Daily depth sits on the typical spread of Daily scores (a normal
 * curve, DAILY_DEPTH_MEAN ± DAILY_DEPTH_SD). Your marker is placed by your
 * depth, with an estimated "better than X%" from that curve; once enough people
 * have played today, the real percentile among today's divers is shown too.
 */
function DailyCurve({ depth, actual, divers, reducedMotion }: { depth: number; actual: number | null; divers: number | null; reducedMotion: boolean }) {
  const W = 320;
  const H = 134;
  const BASE = H - 28;
  const SPAN = 3; // ±3 standard deviations across the width
  const xOf = (z: number) => ((z + SPAN) / (2 * SPAN)) * W;
  const yOf = (z: number) => BASE - Math.exp((-z * z) / 2) * (BASE - 16);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 120; i++) {
    const zz = -SPAN + (2 * SPAN * i) / 120;
    pts.push([xOf(zz), yOf(zz)]);
  }
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const zRaw = (depth - DAILY_DEPTH_MEAN) / DAILY_DEPTH_SD;
  const estimated = Math.min(99, Math.max(1, Math.round(normalCdf(zRaw) * 100)));
  const z = Math.min(SPAN - 0.05, Math.max(-SPAN + 0.05, zRaw));
  const mx = xOf(z);
  const my = yOf(z);
  const filled = pts.filter(([x]) => x <= mx);
  const area = `M0 ${BASE} ${filled.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L${mx.toFixed(1)} ${my.toFixed(1)} L${mx.toFixed(1)} ${BASE} Z`;
  const ticks = [-2, -1, 0, 1, 2].map((t) => ({ x: xOf(t), label: formatDepth(Math.max(0, DAILY_DEPTH_MEAN + t * DAILY_DEPTH_SD)) }));
  return (
    <div className="bell">
      <div className="end-percentile">
        Better than about {estimated}% of players <span className="muted small">(estimated)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Your depth is better than about ${estimated}% of players`}>
        <defs>
          <linearGradient id="bell-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6fe3ff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#6fe3ff" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <line x1="0" y1={BASE} x2={W} y2={BASE} stroke="rgba(220,240,255,0.35)" />
        {ticks.map((t) => (
          <g key={t.label}>
            <line x1={t.x} y1={BASE} x2={t.x} y2={BASE + 4} stroke="rgba(220,240,255,0.45)" />
            <text x={t.x} y={BASE + 15} textAnchor="middle" className="bell-axis">
              {t.label}
            </text>
          </g>
        ))}
        <motion.path d={area} fill="url(#bell-fill)" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.6 }} />
        <motion.path
          d={line}
          fill="none"
          stroke="#cfefff"
          strokeWidth="2.5"
          strokeLinecap="round"
          initial={reducedMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
        <motion.g initial={reducedMotion ? false : { opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1, type: "spring", stiffness: 260, damping: 14 }}>
          <line x1={mx} y1={my - 4} x2={mx} y2={BASE} stroke="#ffd166" strokeWidth="2" strokeDasharray="3 3" />
          <circle cx={mx} cy={my} r="6" fill="#ffd166" stroke="#3a2a00" strokeWidth="1.5" />
          <text x={Math.min(W - 24, Math.max(24, mx))} y={Math.max(12, my - 12)} textAnchor="middle" className="bell-you">
            You
          </text>
        </motion.g>
      </svg>
      <div className="muted small">
        {actual !== null && divers
          ? `Actual: deeper than ${actual}% of today's ${divers.toLocaleString()} divers`
          : `The real percentile shows once ${PERCENTILE_MIN_RESULTS} people have finished today's Daily.`}
      </div>
    </div>
  );
}
