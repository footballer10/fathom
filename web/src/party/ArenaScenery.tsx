import type { ReactNode } from "react";

/**
 * The Battle tank's backdrop, all hand-drawn SVG: a shimmering surface, light
 * dancing on the sand, misty reef ridges and a sunken wreck in the distance,
 * kelp forests on both sides, a coral garden along the floor, and fish, a
 * turtle, a ray and a jellyfish drifting through.
 *
 * Every swimmer is drawn facing right. Ones that swim left are mirrored by
 * the `swim--left` class, so nothing ever swims backwards.
 */
export function ArenaScenery() {
  return (
    <div className="arena-scenery" aria-hidden>
      <Surface />
      <div className="scenery-caustics" />
      <FarReef />
      <Swimmers />
      <KelpForest side="left" />
      <KelpForest side="right" />
      <CoralFloor />
      <div className="scenery-vignette" />
    </div>
  );
}

/** The underside of the water's surface: a bright, wavy band with the sun behind it. */
function Surface() {
  return (
    <svg className="scenery-surface" viewBox="0 0 1600 120" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sc-surface" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bdf3ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#bdf3ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="sc-sun" cx="0.5" cy="0" r="0.5">
          <stop offset="0" stopColor="#fffbe0" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fffbe0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="800" cy="0" rx="520" ry="110" fill="url(#sc-sun)" />
      <path className="surface-wave" d="M0 0 H1600 V34 C 1500 48, 1400 22, 1300 36 C 1200 50, 1100 24, 1000 38 C 900 52, 800 26, 700 40 C 600 54, 500 28, 400 42 C 300 56, 200 30, 100 44 C 50 50, 20 44, 0 40 Z" fill="url(#sc-surface)" />
      <path className="surface-wave surface-wave--2" d="M0 0 H1600 V22 C 1450 34, 1350 14, 1200 26 C 1050 38, 950 16, 800 28 C 650 40, 550 18, 400 30 C 250 42, 150 20, 0 30 Z" fill="#e6fbff" opacity="0.18" />
    </svg>
  );
}

/** Misty ridges and a sunken wreck far behind everything. */
function FarReef() {
  return (
    <svg className="scenery-far" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="sc-fog1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a6aa0" />
          <stop offset="1" stopColor="#0c4475" />
        </linearGradient>
        <linearGradient id="sc-fog2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#11558a" />
          <stop offset="1" stopColor="#09335e" />
        </linearGradient>
      </defs>
      {/* farthest ridge */}
      <path d="M0 400 V230 C 80 200, 140 240, 220 210 C 300 180, 340 150, 420 175 C 500 200, 560 160, 650 170 C 760 182, 820 130, 930 150 C 1040 170, 1100 200, 1200 180 C 1300 160, 1360 120, 1460 150 C 1520 168, 1570 180, 1600 175 V400 Z" fill="url(#sc-fog1)" opacity="0.55" />
      {/* sunken wreck */}
      <g transform="translate(1180 215) rotate(-8)" fill="#0d4a7c" opacity="0.75">
        <path d="M0 40 L240 40 L215 78 L30 78 Z" />
        <rect x="70" y="8" width="70" height="32" />
        <rect x="150" y="-40" width="8" height="80" />
        <rect x="95" y="-24" width="6" height="32" />
        <path d="M158 -36 L200 -10 L158 -6 Z" opacity="0.7" />
        <circle cx="105" cy="24" r="6" fill="#082f55" />
        <circle cx="125" cy="24" r="6" fill="#082f55" />
      </g>
      {/* rock arch */}
      <path d="M180 400 V300 C 180 230, 230 200, 290 205 C 350 210, 390 250, 395 300 V400 H345 V310 C 342 270, 320 252, 290 252 C 258 252, 232 272, 230 310 V400 Z" fill="url(#sc-fog2)" opacity="0.85" />
      {/* nearer ridge */}
      <path d="M0 400 V300 C 120 280, 200 320, 330 300 C 460 280, 520 310, 640 296 C 760 282, 860 316, 980 300 C 1100 284, 1180 312, 1300 298 C 1420 286, 1520 306, 1600 300 V400 Z" fill="url(#sc-fog2)" opacity="0.9" />
    </svg>
  );
}

/** A forest of kelp on one side, each strand swaying on its own beat. */
function KelpForest({ side }: { side: "left" | "right" }) {
  const strands = [
    { x: 30, h: 330, w: 13, d: 0, c: "#2f9a63" },
    { x: 70, h: 260, w: 11, d: -1.1, c: "#3aae6f" },
    { x: 110, h: 300, w: 12, d: -2.2, c: "#27855a" },
    { x: 150, h: 200, w: 10, d: -0.6, c: "#46b878" },
  ];
  return (
    <svg className={`scenery-kelp scenery-kelp--${side}`} viewBox="0 0 190 360" preserveAspectRatio="xMidYMax meet">
      {strands.map((k, i) => {
        const base = 360;
        const top = base - k.h;
        // leaves alternate sides up the stalk
        const leaves = Array.from({ length: Math.floor(k.h / 46) }, (_, j) => {
          const y = base - 40 - j * 46;
          const dir = j % 2 ? 1 : -1;
          return <path key={j} d={`M${k.x} ${y} q ${dir * 26} -6 ${dir * 30} -30 q ${dir * -18} 8 ${dir * -30} 30 Z`} fill={k.c} opacity="0.9" />;
        });
        return (
          <g key={i} className="kelp" style={{ animationDelay: `${k.d}s`, transformOrigin: `${k.x}px ${base}px` }}>
            <path d={`M${k.x} ${base} C ${k.x - 16} ${base - k.h * 0.35}, ${k.x + 16} ${base - k.h * 0.65}, ${k.x} ${top}`} stroke={k.c} strokeWidth={k.w} strokeLinecap="round" fill="none" />
            {leaves}
            <ellipse cx={k.x} cy={top + 6} rx="5" ry="8" fill="#9be08f" opacity="0.8" />
          </g>
        );
      })}
    </svg>
  );
}

/** The sea floor: rippled sand, a coral garden, an anemone with a clownfish, a clam, a chest. */
function CoralFloor() {
  return (
    <svg className="scenery-floor" viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="sc-sand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9be84" />
          <stop offset="1" stopColor="#9c7d47" />
        </linearGradient>
        <radialGradient id="sc-brain" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#f6b26b" />
          <stop offset="1" stopColor="#c9762c" />
        </radialGradient>
        <linearGradient id="sc-chest" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b07a3b" />
          <stop offset="1" stopColor="#7a4f21" />
        </linearGradient>
      </defs>

      {/* fan coral and sea grass behind */}
      <g className="sway" style={{ transformOrigin: "300px 250px" }}>
        <path d="M300 250 C 270 200, 250 170, 262 130 M300 250 C 300 190, 300 160, 300 118 M300 250 C 330 200, 352 170, 340 132 M281 190 L 262 168 M318 188 L 338 166 M300 170 L 288 150 M300 170 L 312 150" stroke="#e05a8a" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.9" />
      </g>
      <g className="sway sway--slow" style={{ transformOrigin: "1240px 250px" }}>
        <path d="M1240 250 C 1215 205, 1200 175, 1210 140 M1240 250 C 1240 200, 1240 170, 1240 130 M1240 250 C 1265 205, 1282 178, 1272 144" stroke="#a46bd6" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.9" />
      </g>
      {[520, 540, 560, 880, 900, 1450, 1470].map((x, i) => (
        <path key={x} className="grass" style={{ animationDelay: `${(i % 3) * -0.7}s`, transformOrigin: `${x}px 262px` }} d={`M${x} 262 C ${x - 6} 240, ${x + 6} 222, ${x - 2} ${200 - (i % 3) * 14}`} stroke="#5cc28a" strokeWidth="4" strokeLinecap="round" fill="none" />
      ))}

      {/* sand */}
      <path d="M0 240 C 160 222, 300 252, 470 240 C 640 228, 780 258, 960 244 C 1140 230, 1280 256, 1440 242 C 1520 236, 1570 240, 1600 238 V300 H0 Z" fill="url(#sc-sand)" />
      <path d="M0 262 C 200 254, 400 270, 600 262 C 800 254, 1000 272, 1200 262 C 1400 252, 1500 266, 1600 260" stroke="#f0dcab" strokeWidth="2" fill="none" opacity="0.5" />
      <path d="M0 280 C 220 272, 420 288, 640 280 C 860 272, 1060 290, 1280 280 C 1440 274, 1540 284, 1600 280" stroke="#f0dcab" strokeWidth="2" fill="none" opacity="0.35" />

      {/* brain coral */}
      <ellipse cx="150" cy="245" rx="62" ry="40" fill="url(#sc-brain)" />
      <path d="M100 240 q 12 -14 24 0 t 24 0 t 24 0 t 24 0 M106 256 q 12 -12 24 0 t 24 0 t 24 0 t 24 0 M118 226 q 10 -10 20 0 t 20 0 t 20 0" stroke="#a65c1e" strokeWidth="2.5" fill="none" opacity="0.7" />

      {/* staghorn coral */}
      <g stroke="#ff8a7a" strokeWidth="10" strokeLinecap="round" fill="none">
        <path d="M420 250 L420 205 L398 178 M420 205 L446 170 M398 178 L384 158 M446 170 L460 150 M420 222 L440 205" />
      </g>

      {/* tube sponges */}
      <g>
        <rect x="690" y="186" width="20" height="64" rx="10" fill="#f4a94e" />
        <rect x="714" y="166" width="22" height="84" rx="11" fill="#e8912f" />
        <rect x="740" y="198" width="18" height="52" rx="9" fill="#f7b866" />
        <ellipse cx="700" cy="188" rx="7" ry="3" fill="#8a4a12" />
        <ellipse cx="725" cy="168" rx="8" ry="3" fill="#8a4a12" />
        <ellipse cx="749" cy="200" rx="6" ry="3" fill="#8a4a12" />
      </g>

      {/* anemone with a clownfish peeking out */}
      <g transform="translate(1010 246)">
        {Array.from({ length: 13 }, (_, i) => {
          const a = -Math.PI + (i / 12) * Math.PI;
          return (
            <path
              key={i}
              className="tentacle"
              style={{ animationDelay: `${(i % 4) * -0.4}s`, transformOrigin: "0px 0px" }}
              d={`M0 0 Q ${Math.cos(a) * 30} ${Math.sin(a) * 30 - 10} ${Math.cos(a) * 46} ${Math.sin(a) * 46}`}
              stroke="#ff9ed8"
              strokeWidth="7"
              strokeLinecap="round"
              fill="none"
            />
          );
        })}
        <ellipse cx="0" cy="4" rx="34" ry="12" fill="#c2569a" />
        <g className="clownfish" transform="translate(14 -26)">
          <ellipse cx="0" cy="0" rx="16" ry="9" fill="#ff7b1c" />
          <path d="M-4 -8 C -1 -2, -1 2, -4 8 M6 -8 C 9 -2, 9 2, 6 8" stroke="#fff" strokeWidth="3.5" fill="none" />
          <path d="M-15 0 L-24 -7 L-22 0 L-24 7 Z" fill="#ff7b1c" />
          <circle cx="10" cy="-2" r="2" fill="#111" />
        </g>
      </g>

      {/* treasure chest */}
      <g transform="translate(560 214)">
        <rect x="0" y="16" width="70" height="38" rx="4" fill="url(#sc-chest)" />
        <path d="M0 18 C 0 -4, 70 -4, 70 18 Z" fill="#c18a47" />
        <rect x="0" y="14" width="70" height="6" fill="#e2b34e" />
        <rect x="31" y="16" width="8" height="14" fill="#ffd166" />
        <circle className="chest-glint" cx="54" cy="6" r="3.5" fill="#fff6c4" />
      </g>

      {/* clam with a pearl and bubbles */}
      <g transform="translate(1330 248)">
        <path d="M-30 0 C -30 -10, 30 -10, 30 0 Z" fill="#c9b8e8" />
        <path d="M-30 0 C -24 -30, 24 -30, 30 0 C 18 -14, -18 -14, -30 0 Z" fill="#e0d4f7" className="clam-lid" />
        <circle cx="0" cy="-5" r="6" fill="#fffaf2" />
        <circle className="clam-bubble" cx="0" cy="-20" r="4" fill="none" stroke="#dff7ff" strokeWidth="1.5" />
        <circle className="clam-bubble clam-bubble--2" cx="4" cy="-20" r="3" fill="none" stroke="#dff7ff" strokeWidth="1.5" />
      </g>

      {/* starfish, urchin, shells */}
      <path d="M840 262 l6 12 l13 1 l-10 9 l3 13 l-12 -7 l-12 7 l3 -13 l-10 -9 l13 -1 Z" fill="#ff7a59" />
      <g transform="translate(1530 258)">
        {Array.from({ length: 14 }, (_, i) => {
          const a = Math.PI + (i / 13) * Math.PI;
          return <line key={i} x1="0" y1="0" x2={Math.cos(a) * 22} y2={Math.sin(a) * 22} stroke="#3b2a5e" strokeWidth="2.5" />;
        })}
        <ellipse cx="0" cy="0" rx="13" ry="9" fill="#4b3576" />
      </g>
      <path d="M250 268 C 250 254, 274 254, 274 268 Z" fill="#ffe0c2" />
      <path d="M1100 272 C 1100 262, 1116 262, 1116 272 Z" fill="#ffd0e0" />
    </svg>
  );
}

/** Fish drawn facing right, with a wagging tail. */
function Fish({ x, y, s = 1, body, fin }: { x: number; y: number; s?: number; body: string; fin: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="fish-tail" d="M2 0 L-10 -8 L-8 0 L-10 8 Z" fill={fin} />
      <path d="M0 0 C 6 -9, 22 -10, 32 0 C 22 10, 6 9, 0 0 Z" fill={body} />
      <path d="M12 -6 C 16 -2, 16 2, 12 6" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" fill="none" />
      <circle cx="25" cy="-1.5" r="1.8" fill="#06213d" />
    </g>
  );
}

function Swimmer({ className, dir, children, w, h }: { className: string; dir: "left" | "right"; children: ReactNode; w: number; h: number }) {
  return (
    <div className={`swimmer ${className} swim--${dir}`}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="swimmer-art">
        {children}
      </svg>
    </div>
  );
}

/** Everything that swims through the tank. All drawn facing right. */
function Swimmers() {
  return (
    <div className="scenery-swimmers">
      <Swimmer className="swimmer--school-a" dir="right" w={150} h={70}>
        {[
          [14, 24, 1],
          [44, 10, 0.85],
          [48, 40, 0.9],
          [80, 22, 0.8],
          [104, 44, 0.75],
        ].map(([x, y, s], i) => (
          <Fish key={i} x={x} y={y} s={s} body="#7fd4ff" fin="#4bb3e6" />
        ))}
      </Swimmer>
      <Swimmer className="swimmer--school-b" dir="left" w={130} h={60}>
        {[
          [12, 20, 0.9],
          [40, 8, 0.8],
          [42, 36, 0.85],
          [72, 22, 0.75],
        ].map(([x, y, s], i) => (
          <Fish key={i} x={x} y={y} s={s} body="#ffc46b" fin="#f0993a" />
        ))}
      </Swimmer>
      <Swimmer className="swimmer--turtle" dir="right" w={130} h={80}>
        <g className="turtle">
          <path className="flipper flipper--front" d="M70 46 C 84 60, 98 70, 104 64 C 96 56, 86 50, 74 44 Z" fill="#7cc48f" />
          <path className="flipper flipper--back" d="M30 46 C 20 58, 8 64, 4 60 C 10 52, 18 48, 28 44 Z" fill="#7cc48f" />
          <path className="flipper flipper--back flipper--back-top" d="M30 34 C 20 22, 8 16, 4 20 C 10 28, 18 32, 28 36 Z" fill="#7cc48f" />
          <ellipse cx="54" cy="40" rx="36" ry="22" fill="#3f8f5a" />
          <path d="M34 36 L46 26 L62 26 L74 36 L66 50 L42 50 Z" fill="#2f7347" />
          <path d="M46 26 L54 18 L62 26 M34 36 L22 34 M74 36 L86 34" stroke="#2f7347" strokeWidth="2" fill="none" />
          <ellipse cx="98" cy="38" rx="13" ry="9" fill="#7cc48f" />
          <circle cx="104" cy="35" r="2" fill="#0b2a18" />
          <path className="flipper flipper--front" d="M68 28 C 84 14, 98 8, 104 12 C 96 20, 84 26, 72 32 Z" fill="#7cc48f" />
        </g>
      </Swimmer>
      <Swimmer className="swimmer--ray" dir="left" w={160} h={70}>
        <g className="ray">
          <path d="M20 35 C 50 5, 80 5, 110 30 C 120 34, 126 36, 132 35 C 126 38, 120 40, 110 42 C 80 66, 50 64, 20 35 Z" fill="#355f86" />
          <path d="M132 35 L158 33" stroke="#355f86" strokeWidth="2.5" />
          <circle cx="112" cy="30" r="1.8" fill="#0c1c2c" />
          <path d="M60 30 C 70 34, 80 34, 90 30" stroke="#5a85ad" strokeWidth="2" fill="none" />
        </g>
      </Swimmer>
      <div className="swimmer--jelly">
        <svg viewBox="0 0 60 100" width="54" height="90">
          <g className="jelly-tentacles" stroke="#ffb3e6" strokeOpacity="0.6" strokeWidth="2" fill="none" strokeLinecap="round">
            <path d="M18 34 C 12 50, 24 62, 16 80" />
            <path d="M30 36 C 26 54, 36 66, 30 90" />
            <path d="M42 34 C 48 50, 36 62, 44 82" />
          </g>
          <path d="M6 34 C 6 8, 54 8, 54 34 C 46 38, 40 32, 30 37 C 20 32, 14 38, 6 34 Z" fill="#ff9ad5" opacity="0.75" />
          <ellipse cx="24" cy="18" rx="7" ry="4" fill="#fff" opacity="0.4" />
        </svg>
      </div>
    </div>
  );
}
