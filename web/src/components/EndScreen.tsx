import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { MISS_EMOJI, formatDepth, shareCardText, tierInfo } from "@krillion/shared";
import type { FinishResponse, RevealResponse } from "@krillion/shared";
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
          <div className="end-percentile">Deeper than {result.percentile}% of today's divers</div>
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
