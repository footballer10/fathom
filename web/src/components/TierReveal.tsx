import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { MISS_EMOJI, formatDepth, pointsToDepth, tierInfo } from "@fathom/shared";
import type { TierPoints } from "@fathom/shared";

/** How big the celebration gets per tier. */
const BURST_SIZE: Record<TierPoints, number> = { 10: 0, 15: 6, 30: 10, 60: 16, 85: 26, 100: 44 };

/**
 * The answer card that pops in after a question: tier color + emoji, the
 * points counting up, and a burst that grows with rarity. One in a Krillion
 * also lights up the whole screen.
 */
export function TierReveal({
  tier,
  canonical,
  corrected,
  guess,
  reducedMotion,
}: {
  tier: TierPoints | null;
  canonical: string | null;
  corrected: boolean;
  guess: string;
  reducedMotion: boolean;
}) {
  const info = tier ? tierInfo(tier) : null;
  const points = useMotionValue(0);
  const pointsText = useTransform(points, (p) => `+${Math.round(p)}`);
  const depthText = useTransform(points, (p) => `${formatDepth(pointsToDepth(Math.round(p)))} deeper`);

  useEffect(() => {
    if (!tier) return;
    // Count up over the same ~1.2s the diver takes to sink.
    const controls = animate(points, tier, { duration: reducedMotion ? 0 : 1.2, ease: "easeOut" });
    return () => controls.stop();
  }, [tier, points, reducedMotion]);

  if (!info) {
    return (
      <motion.div
        className="reveal-card reveal-card--miss"
        initial={reducedMotion ? false : { scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
      >
        <div className="reveal-emoji">{MISS_EMOJI}</div>
        <div className="reveal-title">Time's up</div>
        <div className="reveal-sub">No points this time. The answers are below.</div>
      </motion.div>
    );
  }

  const big = tier! >= 85;
  return (
    <>
      {tier === 100 && !reducedMotion && <ScreenGlow color={info.color} />}
      <motion.div
        className={`reveal-card reveal-card--t${tier}`}
        style={{ "--tier": info.color } as React.CSSProperties}
        initial={reducedMotion ? false : { scale: 0.6, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: big ? 220 : 320, damping: big ? 14 : 20 }}
      >
        {!reducedMotion && <Burst count={BURST_SIZE[tier!]} color={info.color} />}
        <motion.div
          className="reveal-emoji"
          initial={reducedMotion ? false : { rotate: -20, scale: 0.4 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.08 }}
        >
          {info.emoji}
        </motion.div>
        <div className="reveal-tier">{info.name}</div>
        <div className="reveal-answer">{canonical}</div>
        <motion.div className="reveal-points">{pointsText}</motion.div>
        <motion.div className="reveal-depth">{depthText}</motion.div>
        {corrected && canonical && canonical.toLowerCase() !== guess.trim().toLowerCase() && (
          <div className="reveal-corrected">
            Accepted as <strong>{canonical}</strong>.
          </div>
        )}
      </motion.div>
    </>
  );
}

function Burst({ count, color }: { count: number; color: string }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 90 + Math.random() * (60 + count * 4);
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, s: 4 + Math.random() * 6, d: Math.random() * 0.15 };
      }),
    [count],
  );
  if (count === 0) return null;
  return (
    <div className="burst" aria-hidden="true">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="burst-bit"
          style={{ width: b.s, height: b.s, background: i % 3 === 0 ? "#ffffff" : color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: b.x, y: b.y, opacity: 0, scale: 0.3 }}
          transition={{ duration: 0.9 + count / 60, ease: "easeOut", delay: b.d }}
        />
      ))}
    </div>
  );
}

function ScreenGlow({ color }: { color: string }) {
  return createPortal(
    <motion.div
      className="screen-glow"
      style={{ "--glow": color } as React.CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0.6, 0] }}
      transition={{ duration: 2.4, times: [0, 0.15, 0.5, 1] }}
      aria-hidden="true"
    />,
    document.body,
  );
}
