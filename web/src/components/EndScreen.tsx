import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { MISS_EMOJI, formatDepth, shareCardText, tierInfo } from "@fathom/shared";
import type { FinishResponse, RevealResponse } from "@fathom/shared";
import { api, serverNow } from "../api";
import { RevealPanel } from "./RevealPanel";

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
        {result.percentile !== null && (
          <>
            <div className="end-percentile">Deeper than {result.percentile}% of today's divers</div>
            <BellCurve percentile={result.percentile} divers={result.divers ?? null} reducedMotion={reducedMotion} />
          </>
        )}
      </motion.div>

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

      <motion.div className="end-actions" {...fade(0.55)}>
        <button className="btn" onClick={onPlayUnlimited}>
          Play Unlimited
        </button>
        <button className="btn btn--ghost" onClick={onHome}>
          Back to the surface
        </button>
      </motion.div>
    </div>
  );
}

/** Inverse of the standard normal CDF (Acklam's approximation), for placing a percentile on the curve. */
function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -probit(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Where you landed among today's divers, drawn on a smooth bell curve. The
 * curve is always the same ideal shape; only your marker moves, placed by
 * your percentile, so it reads the same however today's scores happened to fall.
 */
function BellCurve({ percentile, divers, reducedMotion }: { percentile: number; divers: number | null; reducedMotion: boolean }) {
  const W = 320;
  const H = 120;
  const SPAN = 3; // ±3 standard deviations across the width
  const xOf = (z: number) => ((z + SPAN) / (2 * SPAN)) * W;
  const yOf = (z: number) => H - 14 - Math.exp((-z * z) / 2) * (H - 30);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 120; i++) {
    const z = -SPAN + (2 * SPAN * i) / 120;
    pts.push([xOf(z), yOf(z)]);
  }
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const p = Math.min(0.99, Math.max(0.01, percentile / 100));
  const z = probit(p);
  const mx = xOf(z);
  const my = yOf(z);
  const filled = pts.filter(([x]) => x <= mx);
  const area = `M0 ${H - 14} ${filled.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L${mx.toFixed(1)} ${my.toFixed(1)} L${mx.toFixed(1)} ${H - 14} Z`;
  const top = 100 - percentile;
  return (
    <div className="bell">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`You placed in the ${percentile}th percentile`}>
        <defs>
          <linearGradient id="bell-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#6fe3ff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#6fe3ff" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <line x1="0" y1={H - 14} x2={W} y2={H - 14} stroke="rgba(220,240,255,0.35)" />
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
          <line x1={mx} y1={my - 4} x2={mx} y2={H - 14} stroke="#ffd166" strokeWidth="2" strokeDasharray="3 3" />
          <circle cx={mx} cy={my} r="6" fill="#ffd166" stroke="#3a2a00" strokeWidth="1.5" />
          <text x={Math.min(W - 24, Math.max(24, mx))} y={Math.max(12, my - 12)} textAnchor="middle" className="bell-you">
            You
          </text>
        </motion.g>
        <text x="4" y={H - 2} className="bell-axis">Shallower</text>
        <text x={W - 4} y={H - 2} textAnchor="end" className="bell-axis">Deeper</text>
      </svg>
      <div className="muted small">
        {top <= 50 ? `Top ${Math.max(1, top)}%` : `Bottom ${percentile}%`} of {divers ? `${divers.toLocaleString()} ` : ""}divers today
      </div>
    </div>
  );
}
