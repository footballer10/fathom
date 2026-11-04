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
  // Near the surface: the sun, the wavy underside of the water and dancing light.
  const surface = useTransform(depth, [0, 600], [1, 0]);
  const surfaceY = useTransform(depth, [0, 600], [0, -160]);
  const caustics = useTransform(depth, [0, 900], [0.14, 0]);
  const reef = useTransform(depth, [0, 300, 1500, 2000], [0.9, 1, 0.6, 0]);
  const reefY = useTransform(depth, [0, 2000], [0, 420]);
  const turtle = useTransform(depth, [0, 500, 1100], [1, 1, 0]);
  const turtleY = useTransform(depth, [0, 1100], [0, -380]);
  const manta = useTransform(depth, [500, 1000, 2300, 2900], [0, 0.9, 0.9, 0]);
  const mantaY = useTransform(depth, [500, 2900], [260, -300]);
  const whale = useTransform(depth, [1300, 1800, 3200, 3800], [0, 0.55, 0.55, 0]);
  const whaleY = useTransform(depth, [1300, 3800], [200, -260]);
  const lantern = useTransform(depth, [2600, 3300, 6000], [0, 1, 1]);
  const lanternY = useTransform(depth, [2600, 7000], [240, -260]);
  const vignette = useTransform(depth, [0, 4000], [0.15, 0.7]);

  return (
    <div className="ocean" aria-hidden="true">
      <motion.div className="ocean-gradient" style={{ background }} />
      <motion.div className="light-rays" style={{ opacity: rays }} />
      <motion.div className="ocean-surface" style={{ opacity: surface, y: surfaceY }}>
        <SurfaceSvg />
      </motion.div>
      <motion.div className="ocean-caustics" style={{ opacity: caustics }} />
      <motion.div className="creature-layer" style={{ opacity: reef, y: reefY }}>
        <DistantReef />
      </motion.div>

      <SpeedStreaks depth={depth} />

      <motion.div className="creature-layer" style={{ opacity: fish, y: fishY }}>
        <FishSchool className="fish-school fish-school--a" />
        <FishSchool className="fish-school fish-school--b" />
        {/* Swims left, so it's mirrored (every fish is drawn facing right). */}
        <FishSchool className="fish-school fish-school--c" colors={["#9fe3ff", "#7fd4ff", "#b8ecff", "#6cc8f5", "#a6e6ff", "#5dbfee"]} />
      </motion.div>
      <motion.div className="creature-layer" style={{ opacity: turtle, y: turtleY }}>
        <SeaTurtle className="ocean-turtle" />
      </motion.div>
      <motion.div className="creature-layer" style={{ opacity: manta, y: mantaY }}>
        <MantaRay className="ocean-manta" />
      </motion.div>
      <motion.div className="creature-layer" style={{ opacity: whale, y: whaleY }}>
        <WhaleSilhouette className="ocean-whale" />
      </motion.div>
      <motion.div className="creature-layer" style={{ opacity: lantern, y: lanternY }}>
        <Lanternfish className="lantern lantern--a" />
        <Lanternfish className="lantern lantern--b" />
        <Lanternfish className="lantern lantern--c" />
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
      <motion.div className="ocean-vignette" style={{ opacity: vignette }} />
    </div>
  );
}

/** Pixels of screen per meter of depth, for how fast the streaks scroll. */
const PX_PER_M = 0.6;

/** Streaks of water rushing past, visible only while you're actually sinking (or rising). */
function SpeedStreaks({ depth }: { depth: MotionValue<number> }) {
  const streakEls = useRef<(HTMLSpanElement | null)[]>([]);
  const streakSeeds = useRef(
    Array.from({ length: 36 }, () => ({ x: Math.random() * 100, y: Math.random(), speed: 1.6 + Math.random() * 1.8, len: 30 + Math.random() * 70 })),
  ).current;
  const speed = useVelocity(depth);
  const streakOpacity = useTransform(speed, [-2500, -300, 0, 300, 2500], [0.9, 0.15, 0, 0.15, 0.9]);

  const draw = (d: number) => {
    const offset = d * PX_PER_M;
    const h = window.innerHeight + 200;
    streakEls.current.forEach((el, i) => {
      if (!el) return;
      const sd = streakSeeds[i];
      const y = (((sd.y * h - offset * sd.speed) % h) + h) % h - 100;
      el.style.transform = `translateY(${y}px)`;
    });
  };
  useMotionValueEvent(depth, "change", draw);
  useEffect(() => draw(depth.get()), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
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
  );
}

// ---------------------------------------------------------------------------
// Creatures (all hand-drawn SVG)
// ---------------------------------------------------------------------------

function Fish({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="fish-tail" d="M1 0 L -11 -7 L -9 0 L -11 7 Z" fill={color} />
      <path d="M0 0 C 8 -9, 26 -9, 34 0 C 26 9, 8 9, 0 0 Z" fill={color} />
      <path d="M8 3 C 16 7, 26 6, 32 1" stroke="rgba(255,255,255,0.35)" strokeWidth="2" fill="none" />
      <path d="M14 -6 C 18 -2, 18 2, 14 6" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" fill="none" />
      <circle cx="27" cy="-1.5" r="1.8" fill="#04223f" />
    </g>
  );
}

const SCHOOL = [
  [0, 10, 1],
  [46, 0, 0.8],
  [40, 30, 0.9],
  [88, 16, 0.75],
  [12, 46, 0.7],
  [80, 50, 0.65],
] as const;
const GOLD = ["#ffd27a", "#ffc15e", "#ffe29a", "#ffcf70", "#ffd88a", "#ffbf4f"];

/** A school of fish, all drawn facing right (left-swimming schools are mirrored in CSS). */
function FishSchool({ className, colors = GOLD }: { className: string; colors?: string[] }) {
  return (
    <svg className={className} viewBox="-15 -12 140 80" width="160" height="92">
      <g className="school-art">
        {SCHOOL.map(([x, y, s], i) => (
          <Fish key={i} x={x} y={y} s={s} color={colors[i % colors.length]} />
        ))}
      </g>
    </svg>
  );
}

/** The underside of the surface: the sun's glow and a slowly rolling wave line. */
function SurfaceSvg() {
  return (
    <svg viewBox="0 0 1600 160" preserveAspectRatio="none" width="100%" height="100%">
      <defs>
        <radialGradient id="oc-sun" cx="0.5" cy="0" r="0.6">
          <stop offset="0" stopColor="#fffbe6" stopOpacity="0.9" />
          <stop offset="0.4" stopColor="#d9f6ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#d9f6ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="oc-wave" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9fbff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#e9fbff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="800" cy="0" rx="700" ry="150" fill="url(#oc-sun)" />
      <path className="surface-wave" d="M-40 0 H1640 V40 C 1520 58, 1400 26, 1280 44 C 1160 62, 1040 30, 920 48 C 800 66, 680 34, 560 52 C 440 70, 320 36, 200 54 C 100 66, 20 52, -40 48 Z" fill="url(#oc-wave)" />
      <path className="surface-wave surface-wave--2" d="M-40 0 H1640 V26 C 1480 40, 1360 18, 1200 30 C 1040 42, 920 20, 760 32 C 600 44, 480 22, 320 34 C 160 46, 60 26, -40 34 Z" fill="#ffffff" opacity="0.14" />
    </svg>
  );
}

/** Misty reef shapes far below, seen through blue haze near the surface. */
function DistantReef() {
  return (
    <svg className="distant-reef" viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice">
      <path d="M0 300 V180 C 90 150, 170 200, 260 170 C 350 140, 410 110, 500 140 C 590 168, 660 120, 760 132 C 880 146, 950 96, 1060 120 C 1170 144, 1240 180, 1340 158 C 1440 136, 1520 150, 1600 146 V300 Z" fill="#2b8fc7" opacity="0.35" />
      <g fill="#237fb5" opacity="0.45">
        <path d="M120 300 C 115 240, 130 200, 122 160 C 132 200, 146 240, 140 300 Z" />
        <path d="M160 300 C 156 250, 168 220, 162 190 C 172 222, 180 250, 176 300 Z" />
        <path d="M1380 300 C 1374 230, 1390 190, 1382 150 C 1394 192, 1406 236, 1400 300 Z" />
        <path d="M1430 300 C 1426 250, 1436 220, 1432 196 C 1442 222, 1448 250, 1446 300 Z" />
      </g>
      <path d="M0 300 V240 C 160 222, 300 256, 470 240 C 640 224, 780 258, 960 244 C 1140 230, 1280 256, 1440 242 C 1520 236, 1570 240, 1600 238 V300 Z" fill="#1e74aa" opacity="0.5" />
    </svg>
  );
}

/** A sea turtle gliding near the surface, facing right (the way it swims). */
function SeaTurtle({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 130 80" width="150" height="92">
      <path className="flipper flipper--back" d="M30 46 C 20 58, 8 64, 4 60 C 10 52, 18 48, 28 44 Z" fill="#8fd1a0" />
      <path className="flipper flipper--back flipper--back-top" d="M30 34 C 20 22, 8 16, 4 20 C 10 28, 18 32, 28 36 Z" fill="#8fd1a0" />
      <path className="flipper flipper--front" d="M70 46 C 84 60, 98 70, 104 64 C 96 56, 86 50, 74 44 Z" fill="#8fd1a0" />
      <ellipse cx="54" cy="40" rx="36" ry="22" fill="#4a9a63" />
      <path d="M34 36 L46 26 L62 26 L74 36 L66 50 L42 50 Z" fill="#3a8052" />
      <ellipse cx="98" cy="38" rx="13" ry="9" fill="#8fd1a0" />
      <circle cx="104" cy="35" r="2" fill="#0b2a18" />
      <path className="flipper flipper--front" d="M68 28 C 84 14, 98 8, 104 12 C 96 20, 84 26, 72 32 Z" fill="#8fd1a0" />
    </svg>
  );
}

/** A manta ray in the twilight zone, facing right. */
function MantaRay({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 220 110" width="240" height="120">
      <g className="manta-wings">
        <path d="M30 55 C 70 5, 120 10, 160 46 C 172 50, 180 54, 188 55 C 180 58, 172 60, 160 64 C 120 100, 70 105, 30 55 Z" fill="#1d4f7a" />
        <path d="M188 55 L218 52" stroke="#1d4f7a" strokeWidth="3" />
        <path d="M70 52 C 90 58, 120 58, 140 52" stroke="#3f77a6" strokeWidth="2.5" fill="none" />
        <circle cx="166" cy="50" r="2.4" fill="#e9f4ff" />
        <path d="M176 48 C 184 44, 188 40, 190 36 M176 62 C 184 66, 188 70, 190 74" stroke="#1d4f7a" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** A huge, faint whale crossing far off in the deep blue, facing right. */
function WhaleSilhouette({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 400 140" width="460" height="160">
      <path d="M20 70 L0 40 L10 70 L0 100 Z M20 70 C 60 30, 180 20, 290 40 C 340 50, 380 60, 392 74 C 380 92, 330 104, 270 106 C 180 110, 70 104, 20 70 Z" fill="#0e3966" />
      <path d="M180 100 C 190 120, 210 128, 226 126 C 214 118, 204 108, 200 100 Z" fill="#0e3966" />
      <path d="M260 92 C 300 96, 340 92, 372 82" stroke="#1a4f84" strokeWidth="3" fill="none" opacity="0.7" />
    </svg>
  );
}

/** Small deep-sea fish with glowing spots, facing right. */
function Lanternfish({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 60 30" width="60" height="30">
      <path className="fish-tail" d="M10 15 L0 8 L3 15 L0 22 Z" fill="#26324a" />
      <path d="M8 15 C 16 5, 40 4, 54 14 C 40 25, 16 25, 8 15 Z" fill="#26324a" />
      <circle cx="47" cy="12" r="3" fill="#cfe9ff" />
      {[18, 24, 30, 36].map((x) => (
        <circle key={x} className="lantern-spot" cx={x} cy="19" r="1.6" fill="#7dfcff" />
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
    // Kept to the sides, so nothing grows up behind the text in the middle.
    [176, 120], [198, 150], [218, 100], [238, 135], [800, 125], [826, 160], [880, 140], [904, 105], [930, 160],
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
