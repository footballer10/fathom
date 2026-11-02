import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

const ORBIT_SECONDS = 2.6;
const STRIKE_SECONDS = 0.55;
const AFTER_SECONDS = 1.6;

/**
 * Shark Tank's moment of truth, before anyone's answers are shown: everyone in
 * the round sits in a circle, the shark swims laps around the inside, then
 * darts out at the diver it bites (they lose a life). On a tie it circles,
 * then the tied divers are called into a tie-break round instead.
 */
export function SharkAttack({
  divers,
  victim,
  tied,
  livesLeft,
  reducedMotion,
  onDone,
}: {
  divers: string[];
  victim: string | null;
  tied: string[];
  livesLeft: number | null;
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<"circle" | "strike" | "after">(reducedMotion ? "after" : "circle");
  const n = divers.length;
  const R = 150; // seat ring radius (px)
  const r = 92; // shark's lap radius
  const seats = useMemo(
    () => divers.map((name, i) => ({ name, a: -Math.PI / 2 + (i / n) * Math.PI * 2 })),
    [divers, n],
  );
  const target = seats.find((s) => s.name === victim);
  // The parent re-renders often (its countdown ticks), so keep the latest callback in a ref
  // and run the timeline once, rather than restarting it on every render.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (reducedMotion) {
      const t = setTimeout(() => done.current(), 1800);
      return () => clearTimeout(t);
    }
    const t1 = setTimeout(() => setPhase(victim ? "strike" : "after"), ORBIT_SECONDS * 1000);
    const t2 = setTimeout(() => setPhase("after"), (ORBIT_SECONDS + (victim ? STRIKE_SECONDS : 0)) * 1000);
    const t3 = setTimeout(() => done.current(), (ORBIT_SECONDS + (victim ? STRIKE_SECONDS : 0) + AFTER_SECONDS) * 1000);
    return () => [t1, t2, t3].forEach(clearTimeout);
  }, [reducedMotion, victim]);

  // Two laps, clockwise, ending just inside the victim (or back at the top on a tie).
  const lap = useMemo(() => {
    const end = target ? target.a : -Math.PI / 2;
    const start = end - Math.PI * 4;
    const k = 40;
    const xs: number[] = [];
    const ys: number[] = [];
    const rot: number[] = [];
    for (let i = 0; i <= k; i++) {
      const a = start + (i / k) * (end - start);
      xs.push(Math.cos(a) * r);
      ys.push(Math.sin(a) * r);
      rot.push((a * 180) / Math.PI + 90); // nose pointing along the circle
    }
    return { xs, ys, rot };
  }, [target]);

  const strikeTo = target ? { x: Math.cos(target.a) * (R - 26), y: Math.sin(target.a) * (R - 26), rotate: (target.a * 180) / Math.PI } : null;

  return (
    <motion.div className="shark-ring-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="shark-ring" style={{ width: R * 2 + 120, height: R * 2 + 120 }}>
        <div className="shark-ring-water" />
        {seats.map((s) => {
          const bitten = phase === "after" && s.name === victim;
          const isTied = phase === "after" && tied.includes(s.name);
          return (
            <motion.div
              key={s.name}
              className={`shark-seat${bitten ? " shark-seat--bitten" : ""}${isTied ? " shark-seat--tied" : ""}`}
              style={{ left: `calc(50% + ${Math.cos(s.a) * R}px)`, top: `calc(50% + ${Math.sin(s.a) * R}px)` }}
              animate={bitten && !reducedMotion ? { x: [0, -8, 8, -5, 5, 0], scale: [1, 1.15, 1] } : {}}
              transition={{ duration: 0.5 }}
            >
              <span className="shark-seat-avatar">{s.name.slice(0, 1).toUpperCase()}</span>
              <span className="shark-seat-name">{s.name}</span>
              {bitten && <span className="shark-seat-hit">−1 ❤️</span>}
            </motion.div>
          );
        })}
        {!reducedMotion && (
          <motion.div
            className="shark-swimmer"
            initial={{ x: lap.xs[0], y: lap.ys[0], rotate: lap.rot[0] }}
            animate={
              phase === "circle"
                ? { x: lap.xs, y: lap.ys, rotate: lap.rot }
                : phase === "strike" && strikeTo
                  ? { ...strikeTo, scale: 1.25 }
                  : strikeTo
                    ? { ...strikeTo, scale: 1.1 }
                    : { x: 0, y: 0, rotate: 0, scale: 0.9 }
            }
            transition={
              phase === "circle"
                ? { duration: ORBIT_SECONDS, ease: "easeInOut" }
                : phase === "strike"
                  ? { duration: STRIKE_SECONDS, ease: [0.6, 0, 0.9, 0.4] }
                  : { duration: 0.4 }
            }
          >
            <SharkSvg chomp={phase !== "circle"} />
          </motion.div>
        )}
        <div className="shark-ring-caption">
          {phase === "circle" ? (
            <span className="muted">🦈 Who gave the most common answer…?</span>
          ) : victim ? (
            <motion.b initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="shark-chomp-text">
              CHOMP! {victim} {victim === "You" ? "lose" : "loses"} a life{livesLeft === 0 ? " and is out!" : livesLeft !== null ? ` (❤️ ${livesLeft} left)` : ""}
            </motion.b>
          ) : tied.length ? (
            <motion.b initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="shark-tie-text">
              Tie! {tied.join(" & ")} go to a tie-break round
            </motion.b>
          ) : (
            <b>The shark swims off hungry…</b>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** A grey shark seen from above-ish, facing right (rotation points it along its path). */
function SharkSvg({ chomp }: { chomp: boolean }) {
  return (
    <svg viewBox="0 0 120 60" width="96" height="48" aria-hidden style={{ overflow: "visible" }}>
      <g className="shark-tail-wag">
        <path d="M14 30 L-4 14 Q4 30 -4 46 Z" fill="#5d7387" />
      </g>
      <path d="M14 30 C 30 12, 78 8, 108 26 C 116 30, 118 32, 112 36 C 90 50, 40 52, 14 30 Z" fill="#7d93a8" />
      <path d="M22 34 C 48 46, 92 44, 112 34 C 92 40, 48 42, 22 34 Z" fill="#e8eef3" />
      <path d="M54 14 L64 -4 L72 16 Z" fill="#6a8196" />
      <circle cx="94" cy="25" r="2.6" fill="#0b1520" />
      <path d={chomp ? "M98 32 L101 39 L104 32 L107 38 L110 32" : "M100 34 L102 37 L104 34 L106 37 L108 34"} fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
