import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

/**
 * Shark Tank's bite: before the reveal shows who was bitten, the shark circles
 * the screen, spins, then darts down at its victim(s). Doesn't block anything:
 * it fades out on its own after a few seconds.
 */
export function SharkAttack({ victims, reducedMotion }: { victims: string[]; reducedMotion: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), reducedMotion ? 1800 : 4400);
    return () => clearTimeout(t);
  }, [reducedMotion]);

  // An orbit of about one and a quarter turns, then a straight dart down at the target.
  const path = useMemo(() => {
    const n = 18;
    const turns = 1.25;
    const xs: number[] = [];
    const ys: number[] = [];
    const rot: number[] = [];
    for (let k = 0; k <= n; k++) {
      const a = -Math.PI / 2 + (k / n) * turns * Math.PI * 2;
      xs.push(Math.cos(a) * 170);
      ys.push(Math.sin(a) * 95 - 40);
      rot.push((a * 180) / Math.PI + 90); // facing along the circle (clockwise)
    }
    const orbitEnd = 0.62;
    const times = xs.map((_, k) => (k / n) * orbitEnd);
    // Wind up (a little pull back), then strike.
    xs.push(xs[n] * 1.1, 0);
    ys.push(ys[n] - 30, 200);
    rot.push(rot[n] + 25, 90 + 360 * Math.ceil(rot[n] / 360));
    times.push(0.74, 0.84);
    xs.push(0);
    ys.push(200);
    rot.push(rot[rot.length - 1]);
    times.push(1);
    return { xs, ys, rot, times };
  }, []);

  if (done) return null;
  const names = victims.join(" & ");
  return (
    <motion.div className="shark-attack" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: reducedMotion ? 1.8 : 4.4, times: [0, 0.05, 0.9, 1] }}>
      <div className="shark-attack-water" />
      {!reducedMotion && (
        <motion.div
          className="shark-attack-shark"
          initial={false}
          animate={{ x: path.xs, y: path.ys, rotate: path.rot, scale: [...path.xs.slice(0, -3).map(() => 1), 1.15, 1.7, 1.5] }}
          transition={{ duration: 2.4, times: path.times, ease: "easeInOut" }}
        >
          <SharkSvg />
        </motion.div>
      )}
      <motion.div
        className="shark-attack-target"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={reducedMotion ? { scale: 1, opacity: 1 } : { scale: [0.8, 1, 1, 1.12, 0.95, 1], opacity: [0, 1, 1, 1, 1, 1], x: [0, 0, 0, -10, 10, 0] }}
        transition={{ duration: reducedMotion ? 0.3 : 2.6, times: reducedMotion ? undefined : [0, 0.15, 0.78, 0.84, 0.9, 1] }}
      >
        🎯 {names}
      </motion.div>
      <motion.div
        className="shark-attack-chomp"
        initial={{ opacity: 0, scale: 0.3 }}
        animate={{ opacity: [0, 0, 1, 1], scale: [0.3, 0.3, 1.3, 1] }}
        transition={{ duration: reducedMotion ? 0.6 : 2.7, times: [0, reducedMotion ? 0.1 : 0.78, reducedMotion ? 0.5 : 0.88, 1] }}
      >
        CHOMP! {names} {victims.length === 1 ? "was" : "were"} bitten!
      </motion.div>
    </motion.div>
  );
}

/** A grey shark facing right, drawn here. */
function SharkSvg() {
  return (
    <svg viewBox="0 0 160 80" width="160" height="80" aria-hidden>
      <path d="M10 40 L-6 22 Q2 40 -6 58 Z" fill="#5d7387" transform="translate(14 0)" />
      <path d="M20 40 C 40 18, 100 14, 140 34 C 150 38, 154 42, 148 46 C 120 60, 50 64, 20 40 Z" fill="#7d93a8" />
      <path d="M30 44 C 60 58, 120 56, 146 44 C 120 52, 60 54, 30 44 Z" fill="#e8eef3" />
      <path d="M70 22 L84 2 L92 24 Z" fill="#6a8196" />
      <path d="M76 50 L66 66 L90 54 Z" fill="#6a8196" />
      <circle cx="124" cy="34" r="3.2" fill="#0b1520" />
      <path d="M132 45 L135 50 L138 45 L141 49 L144 44" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M104 30 Q106 36 104 42 M98 31 Q100 37 98 43 M92 32 Q94 38 92 44" fill="none" stroke="#5d7387" strokeWidth="1.5" />
    </svg>
  );
}
