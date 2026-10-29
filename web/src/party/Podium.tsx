import { useEffect, useMemo, useRef, useState } from "react";
import { animate, motion } from "framer-motion";
import { formatDepth, type GameResult } from "@fathom/shared";

const MEDALS = ["🥇", "🥈", "🥉"];
/** Seconds after the podium appears that each place is revealed: 3rd, then 2nd, then 1st. */
const REVEAL_AT = [2.0, 1.1, 0.3];

/**
 * The end-of-game podium: places rise one at a time (3rd, 2nd, then 1st),
 * depths count up, and the winner gets a crown, a glow and a burst of bubbles.
 */
export function Podium({
  results,
  you,
  reducedMotion,
  onDone,
}: {
  results: GameResult[];
  you: string;
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const top = results.slice(0, 3);
  const winnerAt = REVEAL_AT[0] + 0.9;
  useEffect(() => {
    if (reducedMotion) return onDone();
    const t = setTimeout(onDone, (winnerAt + 1.2) * 1000);
    return () => clearTimeout(t);
  }, [reducedMotion, onDone, winnerAt]);

  return (
    <div className="podium-stage">
      <motion.p
        className="podium-intro"
        initial={reducedMotion ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {top.length > 1 ? "And the deepest diver is…" : "Final depth"}
      </motion.p>
      <div className="podium">
        {[1, 0, 2].map((i) =>
          top[i] ? <Step key={top[i].playerId} r={top[i]} place={i} delay={reducedMotion ? 0 : REVEAL_AT[i]} you={you} reducedMotion={reducedMotion} /> : null,
        )}
      </div>
      {top[0] && (
        <motion.div
          className="winner-banner"
          initial={reducedMotion ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: reducedMotion ? 0 : winnerAt, type: "spring", stiffness: 260, damping: 14 }}
        >
          🏆 {top[0].playerId === you ? "You win!" : `${top[0].nickname} wins!`}
        </motion.div>
      )}
    </div>
  );
}

function Step({ r, place, delay, you, reducedMotion }: { r: GameResult; place: number; delay: number; you: string; reducedMotion: boolean }) {
  const depthRef = useRef<HTMLDivElement>(null);
  const heights = [150, 110, 80];

  // Count the depth up from 0 as the block rises.
  useEffect(() => {
    const el = depthRef.current;
    if (!el) return;
    if (reducedMotion) {
      el.textContent = formatDepth(r.depth);
      return;
    }
    el.textContent = formatDepth(0);
    const controls = animate(0, r.depth, {
      delay,
      duration: 1.1,
      ease: "easeOut",
      onUpdate: (v) => (el.textContent = formatDepth(Math.round(v / 10) * 10)),
    });
    return () => controls.stop();
  }, [r.depth, delay, reducedMotion]);

  const spring = { type: "spring" as const, stiffness: place === 0 ? 120 : 160, damping: place === 0 ? 11 : 16, delay };
  return (
    <div className={`podium-step podium-${place + 1}${r.playerId === you ? " podium-step--you" : ""}`}>
      {place === 0 && !reducedMotion && <BubbleBurst delay={delay + 0.7} />}
      <motion.div
        className="podium-who"
        initial={reducedMotion ? false : { opacity: 0, y: 24, scale: 0.6 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...spring, delay: delay + 0.35 }}
      >
        {place === 0 && (
          <motion.div
            className="podium-crown"
            initial={reducedMotion ? false : { y: -60, opacity: 0, rotate: -25 }}
            animate={{ y: 0, opacity: 1, rotate: 0 }}
            transition={{ delay: delay + 0.85, type: "spring", stiffness: 300, damping: 12 }}
          >
            👑
          </motion.div>
        )}
        <div className="podium-medal">{MEDALS[place]}</div>
        <div className="podium-name">
          {r.nickname}
          {r.playerId === you && <span className="podium-you"> (you)</span>}
        </div>
        <div ref={depthRef} className="podium-depth" />
      </motion.div>
      <motion.div
        className="podium-block"
        style={{ originY: 1 }}
        initial={reducedMotion ? false : { height: 0, opacity: 0.4 }}
        animate={{ height: heights[place], opacity: 1 }}
        transition={spring}
      >
        {place + 1}
      </motion.div>
    </div>
  );
}

/** A one-off burst of bubbles rising from the winner's block. */
function BubbleBurst({ delay }: { delay: number }) {
  const bubbles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 220,
        size: 6 + Math.random() * 16,
        rise: 140 + Math.random() * 160,
        dur: 1.4 + Math.random() * 1.1,
        wait: Math.random() * 0.5,
        hue: [190, 200, 45, 280][i % 4],
      })),
    [],
  );
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), (delay + 3.2) * 1000);
    return () => clearTimeout(t);
  }, [delay]);
  if (gone) return null;
  return (
    <div className="bubble-burst" aria-hidden>
      {bubbles.map((b) => (
        <motion.span
          key={b.id}
          className="burst-bubble"
          style={{ width: b.size, height: b.size, "--b-hue": b.hue } as React.CSSProperties}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: b.x, y: -b.rise, opacity: [0, 1, 1, 0], scale: 1 }}
          transition={{ delay: delay + b.wait, duration: b.dur, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
