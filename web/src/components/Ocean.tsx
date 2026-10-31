import { motion, useMotionValueEvent, useTransform, useVelocity } from "framer-motion";
import type { MotionValue } from "framer-motion";
import { useEffect, useRef } from "react";

/**
 * The full-screen ocean: a depth-driven gradient, surface light rays, and
 * original SVG creatures that fade in by zone. Everything reads from one
 * animated `depth` motion value, so the whole scene sinks together.
 */

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

// [depth in meters, top color, bottom color]
const STOPS: [number, RGB, RGB][] = [
  [0, hex("#5ccff5"), hex("#0a6fb0")],
  [1000, hex("#1769b8"), hex("#073a73")],
  [2500, hex("#0a2c5e"), hex("#03142e")],
  [4000, hex("#06142c"), hex("#020812")],
  [5500, hex("#030a17"), hex("#010307")],
  [7000, hex("#010409"), hex("#000000")],
];

function mix(a: RGB, b: RGB, t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function oceanGradient(depth: number): string {
  const d = Math.max(0, depth);
  let i = 0;
  while (i < STOPS.length - 2 && d > STOPS[i + 1][0]) i++;
  const [d0, top0, bot0] = STOPS[i];
  const [d1, top1, bot1] = STOPS[i + 1];
  const t = Math.min(1, (d - d0) / (d1 - d0));
  return `linear-gradient(180deg, ${mix(top0, top1, t)} 0%, ${mix(bot0, bot1, t)} 100%)`;
}

export function Ocean({ depth }: { depth: MotionValue<number> }) {
  const background = useTransform(depth, oceanGradient);
  const rays = useTransform(depth, [0, 1400], [0.55, 0]);
  const fish = useTransform(depth, [0, 900, 1400], [1, 0.9, 0]);
  const jelly = useTransform(depth, [700, 1200, 2700, 3300], [0, 1, 1, 0]);
  const angler = useTransform(depth, [2200, 2700, 4400, 5000], [0, 1, 1, 0]);
  const abyss = useTransform(depth, [3700, 4300], [0, 1]);
  const floor = useTransform(depth, [4900, 5600], [0, 1]);
  const floorY = useTransform(depth, [4900, 5600], [80, 0]);
  // Creatures drift up past you as you sink, so a dive feels like moving, not a colour change.
  const fishY = useTransform(depth, [0, 1400], [0, -520]);
  const jellyY = useTransform(depth, [700, 3300], [380, -420]);
  const anglerY = useTransform(depth, [2200, 5000], [300, -320]);

  return (
    <div className="ocean" aria-hidden="true">
      <motion.div className="ocean-gradient" style={{ background }} />
      <motion.div className="light-rays" style={{ opacity: rays }} />

      <DepthRuler depth={depth} />
      <Diver depth={depth} />

      <motion.div className="creature-layer" style={{ opacity: fish, y: fishY }}>
        <FishSchool className="fish-school fish-school--a" />
        <FishSchool className="fish-school fish-school--b" />
      </motion.div>

      <motion.div className="creature-layer" style={{ opacity: jelly, y: jellyY }}>
        <Jellyfish className="jelly jelly--a" hue="#ff9ad5" />
        <Jellyfish className="jelly jelly--b" hue="#a5b4ff" />
        <Jellyfish className="jelly jelly--c" hue="#c3a6ff" />
      </motion.div>

      <motion.div className="creature-layer" style={{ opacity: angler, y: anglerY }}>
        <Anglerfish className="angler" />
      </motion.div>

      <motion.div className="creature-layer abyss-glow" style={{ opacity: abyss }} />

      <motion.div className="creature-layer" style={{ opacity: floor, y: floorY }}>
        <Seafloor />
      </motion.div>
    </div>
  );
}

/** Pixels of screen per meter of depth for the scrolling markers. */
const PX_PER_M = 0.6;
const MARK_EVERY = 100;
const LABELS = 14;

/**
 * Depth markers that scroll up past you as you sink (a line every 100 m, a
 * label every 500 m), plus speed streaks that only show while you're moving.
 */
function DepthRuler({ depth }: { depth: MotionValue<number> }) {
  const lines = useRef<HTMLDivElement>(null);
  const streakEls = useRef<(HTMLSpanElement | null)[]>([]);
  const streakSeeds = useRef(
    Array.from({ length: 36 }, () => ({ x: Math.random() * 100, y: Math.random(), speed: 1.6 + Math.random() * 1.8, len: 30 + Math.random() * 70 })),
  ).current;
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const speed = useVelocity(depth);
  const streakOpacity = useTransform(speed, [-2500, -300, 0, 300, 2500], [0.9, 0.15, 0, 0.15, 0.9]);

  const draw = (d: number) => {
    const offset = d * PX_PER_M;
    if (lines.current) lines.current.style.backgroundPositionY = `${-offset}px`;
    const h = window.innerHeight + 200;
    streakEls.current.forEach((el, i) => {
      if (!el) return;
      const sd = streakSeeds[i];
      const y = (((sd.y * h - offset * sd.speed) % h) + h) % h - 100;
      el.style.transform = `translateY(${y}px)`;
    });
    // Labels every 500 m, positioned relative to the middle of the screen.
    const mid = window.innerHeight / 2;
    const first = Math.floor((d - mid / PX_PER_M) / 500) * 500;
    labels.current.forEach((el, i) => {
      if (!el) return;
      const m = first + i * 500;
      const y = mid + (m - d) * PX_PER_M;
      const show = m > 0 && y > -40 && y < window.innerHeight + 40;
      el.style.transform = `translateY(${y}px)`;
      el.style.opacity = show ? "1" : "0";
      if (show) el.textContent = `${m.toLocaleString()} m`;
    });
  };
  useMotionValueEvent(depth, "change", draw);
  useEffect(() => {
    draw(depth.get());
    const onResize = () => draw(depth.get());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="depth-ruler">
      <div ref={lines} className="depth-ruler-lines" style={{ backgroundSize: `100% ${MARK_EVERY * PX_PER_M}px` }} />
      <motion.div className="depth-streaks" style={{ opacity: streakOpacity }}>
        {streakSeeds.map((sd, i) => (
          <span
            key={i}
            ref={(el) => {
              streakEls.current[i] = el;
            }}
            style={{ left: `${sd.x}%`, height: sd.len }}
          />
        ))}
      </motion.div>
      {Array.from({ length: LABELS }, (_, i) => (
        <span key={i} ref={(el) => {
            labels.current[i] = el;
          }} className="depth-ruler-label" />
      ))}
    </div>
  );
}

/** You: a little diver who tips head-down and kicks while sinking, then levels out. */
function Diver({ depth }: { depth: MotionValue<number> }) {
  const speed = useVelocity(depth);
  const rotate = useTransform(speed, [-1500, 0, 1500], [-40, 0, 70]);
  const kick = useRef<SVGGElement>(null);
  useMotionValueEvent(speed, "change", (v) => kick.current?.classList.toggle("diver-kick--on", Math.abs(v) > 120));
  return (
    <motion.div className="diver" style={{ rotate }}>
      <svg viewBox="-40 -30 80 60" width="96" height="72">
        <g ref={kick} className="diver-kick">
          <path d="M-22 4 L-38 -2 L-36 8 Z" fill="#ffcf4d" />
          <path d="M-22 -2 L-38 -10 L-37 0 Z" fill="#ffb92e" />
        </g>
        <rect x="-24" y="-6" width="36" height="12" rx="6" fill="#163a5c" />
        <rect x="-14" y="-13" width="18" height="8" rx="3" fill="#ffcf4d" stroke="#8a5a00" strokeWidth="1" />
        <circle cx="18" cy="0" r="9" fill="#f2c8a0" />
        <rect x="14" y="-6" width="12" height="7" rx="3" fill="#7fe6ff" stroke="#0b3b5c" strokeWidth="1.5" />
        <path d="M4 5 L14 14" stroke="#163a5c" strokeWidth="4" strokeLinecap="round" />
        <circle className="diver-bubble" cx="28" cy="-10" r="2.2" fill="none" stroke="#dff7ff" strokeWidth="1" />
        <circle className="diver-bubble diver-bubble--2" cx="30" cy="-16" r="1.6" fill="none" stroke="#dff7ff" strokeWidth="1" />
      </svg>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Creatures (all hand-drawn SVG)
// ---------------------------------------------------------------------------

function Fish({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 0 C 8 -9, 26 -9, 34 0 C 26 9, 8 9, 0 0 Z" fill={color} />
      <path d="M-1 0 L -11 -7 L -9 0 L -11 7 Z" fill={color} />
      <path d="M14 -6 C 18 -2, 18 2, 14 6" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" fill="none" />
      <circle cx="27" cy="-1.5" r="1.8" fill="#04223f" />
    </g>
  );
}

function FishSchool({ className }: { className: string }) {
  const fish = [
    [0, 10, 1, "#ffd27a"],
    [46, 0, 0.8, "#ffc15e"],
    [40, 30, 0.9, "#ffe29a"],
    [88, 16, 0.75, "#ffcf70"],
    [12, 46, 0.7, "#ffd88a"],
    [80, 50, 0.65, "#ffbf4f"],
  ] as const;
  return (
    <svg className={className} viewBox="-15 -12 140 80" width="160" height="92">
      {fish.map(([x, y, s, c], i) => (
        <Fish key={i} x={x} y={y} s={s} color={c} />
      ))}
    </svg>
  );
}

function Jellyfish({ className, hue }: { className: string; hue: string }) {
  const id = `jg-${className.replace(/\W/g, "")}`;
  return (
    <svg className={className} viewBox="0 0 80 140" width="80" height="140">
      <defs>
        <radialGradient id={id} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="45%" stopColor={hue} stopOpacity="0.75" />
          <stop offset="100%" stopColor={hue} stopOpacity="0.15" />
        </radialGradient>
      </defs>
      <g className="jelly-tentacles" stroke={hue} strokeOpacity="0.55" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M22 44 C 16 64, 28 80, 20 100 S 24 126, 18 136" />
        <path d="M34 46 C 30 70, 40 86, 34 108" />
        <path d="M46 46 C 50 68, 40 84, 46 110 S 42 126, 48 134" />
        <path d="M58 44 C 64 62, 54 80, 60 98" />
      </g>
      <path d="M8 44 C 8 10, 72 10, 72 44 C 64 48, 58 42, 52 47 C 46 42, 40 48, 34 43 C 28 48, 20 42, 8 44 Z" fill={`url(#${id})`} />
      <ellipse cx="32" cy="24" rx="9" ry="5" fill="#fff" opacity="0.35" />
    </svg>
  );
}

function Anglerfish({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 220 160" width="220" height="160">
      <defs>
        <radialGradient id="lure-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffbd1" stopOpacity="1" />
          <stop offset="30%" stopColor="#c6ff9e" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#7cffc4" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* lure stalk + glowing bulb */}
      <path d="M118 62 C 128 24, 158 14, 176 26" stroke="#2d3b4f" strokeWidth="3" fill="none" />
      <circle className="angler-lure-halo" cx="178" cy="30" r="26" fill="url(#lure-glow)" />
      <circle cx="178" cy="30" r="5" fill="#fffde0" />
      {/* body */}
      <path
        d="M30 92 C 34 50, 92 40, 132 62 C 150 72, 160 88, 158 98 C 150 112, 128 126, 96 128 C 64 130, 34 120, 30 92 Z"
        fill="#1b2433"
        stroke="#33445c"
        strokeWidth="2"
      />
      {/* tail */}
      <path d="M32 92 L 6 70 L 12 94 L 4 118 Z" fill="#1b2433" stroke="#33445c" strokeWidth="2" />
      {/* jaw + teeth */}
      <path d="M158 98 C 140 100, 122 102, 108 112" stroke="#0b0f17" strokeWidth="4" fill="none" />
      <path d="M150 96 l3 8 l3 -8 M140 98 l3 9 l3 -9 M130 100 l3 9 l3 -9 M120 104 l3 8 l3 -8" stroke="#e9efe4" strokeWidth="2" fill="none" />
      {/* eye */}
      <circle cx="132" cy="78" r="7" fill="#0b0f17" />
      <circle cx="134" cy="76" r="2.4" fill="#9dfcd2" />
      {/* fin */}
      <path d="M78 104 C 86 116, 98 120, 108 116" stroke="#33445c" strokeWidth="2" fill="none" />
    </svg>
  );
}

function Seafloor() {
  const worms = [
    [70, 120], [92, 150], [112, 100], [500, 130], [526, 165], [548, 110], [880, 140], [904, 105], [930, 160],
  ];
  return (
    <svg className="seafloor" viewBox="0 0 1000 260" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#141a22" />
          <stop offset="1" stopColor="#050608" />
        </linearGradient>
      </defs>
      {worms.map(([x, h], i) => (
        <g key={i} className="tube-worm" style={{ animationDelay: `${(i % 4) * -0.9}s`, transformOrigin: `${x}px 240px` }}>
          <path d={`M${x} 240 C ${x - 6} ${240 - h * 0.5}, ${x + 6} ${240 - h * 0.7}, ${x} ${240 - h}`} stroke="#d9d4c7" strokeWidth="9" fill="none" strokeLinecap="round" />
          <ellipse cx={x} cy={240 - h - 6} rx="9" ry="11" fill="#e0314f" />
          <ellipse cx={x - 2} cy={240 - h - 9} rx="3" ry="4" fill="#ff7a8e" opacity="0.7" />
        </g>
      ))}
      <path d="M0 210 C 120 190, 220 230, 360 214 C 480 200, 600 236, 740 216 C 840 202, 930 222, 1000 210 L 1000 260 L 0 260 Z" fill="url(#floor)" />
      <path d="M0 232 C 160 222, 300 248, 480 236 C 640 226, 820 250, 1000 236 L 1000 260 L 0 260 Z" fill="#030405" />
    </svg>
  );
}
