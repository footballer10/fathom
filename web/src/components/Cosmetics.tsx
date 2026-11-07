import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { DEFAULT_LOOK, ITEM_BY_ID, NAME_COLORS, SKIN_STYLES } from "@fathom/shared";
import type { Look, ShopItem, SkinStyle } from "@fathom/shared";
import { onCelebrate, useMyLook } from "../rewards";

/**
 * Everything the shop sells, drawn from scratch: submarine paint jobs, trails,
 * sidekicks, celebrations, ocean colours, titles and name colours.
 */

// ---------------------------------------------------------------------------
// Submarines
// ---------------------------------------------------------------------------

// A rounder hull with a blunt nose, a tower with a rounded top, and two-blade propeller.
const HULL = "M13 22 C 13 14.5, 21 11.5, 34 11.5 C 49 11.5, 59.5 15, 59.5 22 C 59.5 29, 49 32.5, 34 32.5 C 21 32.5, 13 29.5, 13 22 Z";
const TOWER = "M27.5 12 L29.5 5.5 Q 30 4, 31.5 4 L 40.5 4 Q 42 4, 42.5 5.5 L 44.5 12 Z";
const RAINBOW = ["#ff5e5e", "#ffa53d", "#ffe156", "#6ee07a", "#5ec8ff", "#a77bff"];
const WINDOWS = [27, 37.5, 48];

function Star({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  const d = `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`;
  return <path d={d} fill={fill} />;
}

/** The pattern painted on the hull (clipped to it). Kept clear of the window band where it would clash. */
function HullPattern({ style }: { style: SkinStyle }) {
  const a = style.accent ?? style.dark;
  switch (style.pattern) {
    case "stripes":
      // Tiger stripes: bold, slightly curved bands that taper toward the middle.
      return (
        <g fill={a}>
          {[17, 24, 33, 42, 51].map((x) => (
            <path key={x} d={`M${x - 1.6} 9 Q ${x + 1.5} 16, ${x} 22 Q ${x + 1.5} 28, ${x - 1.2} 35 L ${x + 1.6} 35 Q ${x + 3.4} 28, ${x + 1.6} 22 Q ${x + 3.4} 16, ${x + 1.8} 9 Z`} />
          ))}
        </g>
      );
    case "dots":
      return (
        <g fill={a} opacity="0.9">
          {[
            [19, 15, 1.8],
            [33, 14, 1.5],
            [44, 14.5, 1.9],
            [55, 17, 1.4],
            [20, 28.5, 1.5],
            [31, 30, 2],
            [43, 30, 1.6],
            [53, 28, 1.9],
          ].map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
          ))}
        </g>
      );
    case "teeth":
      // White belly with a toothy grin at the nose.
      return (
        <g>
          <path d="M10 26 C 24 31, 46 31, 62 25 L 62 36 L 10 36 Z" fill="#e9f1f7" />
          <path d="M47 25.5 Q 54 29, 59.5 24.5 L 59.5 27.5 Q 54 31.5, 47 27.5 Z" fill="#3a1d24" />
          <path d="M48.5 26.2 L49.6 28 L50.8 26.7 L52 28.6 L53.2 27 L54.4 28.5 L55.6 26.6 L56.8 27.8 L58 26" fill="none" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
        </g>
      );
    case "flames":
      return (
        <g>
          <path d="M10 25 C 18 23, 20 27, 26 21 C 27 26, 31 25, 34 19 C 35 25, 40 25, 43 21 C 43 27, 37 31, 30 32 C 22 33, 14 31, 10 28 Z" fill={a} />
          <path d="M10 27 C 16 26, 19 28, 24 25 C 25 28, 29 28, 32 25 C 32 29, 26 31, 20 31 C 15 31, 12 30, 10 29 Z" fill="#ffd166" />
        </g>
      );
    case "stars":
      return (
        <g>
          {[
            [19, 16, 1.6],
            [22, 28, 1.1],
            [32, 14.5, 1.1],
            [33, 29.5, 1.6],
            [44, 14.5, 1.4],
            [44, 29, 1],
            [55, 20, 1.2],
            [53, 27, 0.8],
          ].map(([x, y, r]) => (
            <Star key={`${x}-${y}`} x={x} y={y} r={r} fill={a} />
          ))}
          <circle cx="26" cy="15" r="0.5" fill="#fff" />
          <circle cx="39" cy="31" r="0.5" fill="#fff" />
          <circle cx="50" cy="15.5" r="0.5" fill="#fff" />
        </g>
      );
    case "scales":
      return (
        <g fill="none" stroke={a} strokeWidth="0.9" opacity="0.9">
          {[13, 17, 27, 31].map((y, row) =>
            [12, 17, 22, 27, 32, 37, 42, 47, 52, 57].map((x) => <path key={`${x}-${y}`} d={`M${x + (row % 2) * 2.5 - 2.5} ${y} a2.5 2.5 0 0 0 5 0`} />),
          )}
        </g>
      );
    case "rivets":
      return (
        <g>
          <path d="M13 17 L59 17 M13 27.5 L59 27.5" stroke={style.dark} strokeWidth="0.9" opacity="0.55" />
          {[16, 21, 32, 43, 53, 57].map((x) => (
            <g key={x} fill={a}>
              <circle cx={x} cy="14.3" r="0.9" />
              <circle cx={x} cy="30" r="0.9" />
            </g>
          ))}
        </g>
      );
    case "rainbow":
      return (
        <g>
          {RAINBOW.map((c, i) => (
            <rect key={c} x="8" y={10.5 + i * 3.8} width="56" height="4" fill={c} />
          ))}
        </g>
      );
    default:
      return null;
  }
}

/** A submarine in any paint job, facing right. Shaded so it reads as round, not flat. */
export function SubArt({ skin, hue, width = 46 }: { skin?: string; hue?: number; width?: number }) {
  const id = useId().replace(/:/g, "");
  const base = SKIN_STYLES[skin ?? DEFAULT_LOOK.skin] ?? SKIN_STYLES[DEFAULT_LOOK.skin];
  const style: SkinStyle = hue !== undefined && !skin ? { body: `hsl(${hue} 75% 62%)`, dark: `hsl(${hue} 60% 38%)`, glass: "#bdefff" } : base;
  const { body, dark, glass } = style;
  const p = style.pattern;
  const tall = p === "crown" || p === "glow" || p === "spikes";
  return (
    <svg className="sub-svg" width={width} height={width * (tall ? 0.72 : 0.62)} viewBox={tall ? "0 -6 64 46" : "0 0 64 40"} aria-hidden="true">
      <defs>
        <clipPath id={`hull-${id}`}>
          <path d={HULL} />
        </clipPath>
        <radialGradient id={`glass-${id}`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor={glass} />
          <stop offset="1" stopColor={dark} stopOpacity="0.55" />
        </radialGradient>
      </defs>
      {p === "glow" && (
        <g className="sub-lure">
          <path d="M45 7 C 51 -3, 60 -3, 61 5" fill="none" stroke={dark} strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="61" cy="6.5" r="5" fill={style.accent} opacity="0.3" />
          <circle cx="61" cy="6.5" r="2.4" fill={style.accent} />
        </g>
      )}
      {p === "spikes" && (
        <g fill={style.accent} stroke={dark} strokeWidth="0.5" strokeLinejoin="round">
          {[17, 23, 48, 54].map((x) => (
            <path key={`t${x}`} d={`M${x - 1.8} 13.5 L${x + 0.5} 8 L${x + 1.8} 13 Z`} />
          ))}
          {[18, 26, 34, 42, 50].map((x) => (
            <path key={`b${x}`} d={`M${x - 1.8} 31 L${x + 0.5} 36.5 L${x + 1.8} 31.3 Z`} />
          ))}
        </g>
      )}
      {/* propeller: two blades that spin */}
      <rect x="6.5" y="20.6" width="7" height="2.8" rx="1" fill={dark} />
      <g className="sub-prop">
        <ellipse cx="5.5" cy="17.5" rx="1.6" ry="4.2" fill={dark} />
        <ellipse cx="5.5" cy="26.5" rx="1.6" ry="4.2" fill={dark} />
        <circle cx="5.5" cy="22" r="1.6" fill={dark} />
      </g>
      {/* rudder fins */}
      <path d="M15 17.5 L9 12.5 Q 8 12, 8.6 13.4 L 12.5 19.5 Z M15 26.5 L9 31.5 Q 8 32, 8.6 30.6 L 12.5 24.5 Z" fill={dark} />
      {/* hull, pattern and shading */}
      <path d={HULL} fill={body} />
      <g clipPath={`url(#hull-${id})`}>
        <HullPattern style={style} />
        {/* shadow underneath, shine on top */}
        <path d="M8 26 C 22 34, 48 34, 64 25 L 64 40 L 8 40 Z" fill="#000" opacity="0.18" />
        <path d="M18 15.5 C 26 12.5, 44 12, 54 15" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity={p === "rainbow" ? 0.55 : 0.4} />
      </g>
      <path d={HULL} fill="none" stroke={dark} strokeWidth="1.4" />
      {/* tower (the shark has a dorsal fin instead) */}
      {p === "teeth" ? (
        <path d="M29 12 Q 33 6, 38.5 1.5 Q 39.5 6.5, 43 12 Z" fill={body} stroke={dark} strokeWidth="1.4" strokeLinejoin="round" />
      ) : (
        <>
          <path d="M38 4 L38 0.8 Q 38 0, 39 0 L 44.5 0" fill="none" stroke={dark} strokeWidth="1.6" strokeLinecap="round" />
          <path d={TOWER} fill={p === "rainbow" ? RAINBOW[5] : body} stroke={dark} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M30.5 6.5 L 41 6.5" stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
        </>
      )}
      {p === "crown" && (
        <g>
          <path d="M29.5 4.5 L30.5 -4 L33.5 0 L36 -5.5 L38.5 0 L41.5 -4 L42.5 4.5 Z" fill={style.accent} stroke={dark} strokeWidth="0.8" strokeLinejoin="round" />
          <circle cx="36" cy="1.5" r="1" fill="#ff5e8a" />
        </g>
      )}
      {/* portholes: a ring, tinted glass and a glint */}
      {(p === "teeth" ? [27] : WINDOWS).map((x) => (
        <g key={x}>
          <circle cx={x} cy="21.5" r="4.2" fill={dark} />
          <circle cx={x} cy="21.5" r="3.1" fill={`url(#glass-${id})`} className={p === "glow" ? "sub-window-glow" : undefined} />
          <circle cx={x - 1.1} cy="20.3" r="0.9" fill="#fff" opacity="0.9" />
        </g>
      ))}
      {p === "teeth" && (
        <g>
          <circle cx="50" cy="19" r="1.7" fill="#fff" />
          <circle cx="50.5" cy="19" r="0.9" fill="#111" />
          <path d="M34 17.5 L 34 25.5 M37 17 L 37 26 M40 17.5 L 40 25.5" stroke={dark} strokeWidth="0.9" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Trails
// ---------------------------------------------------------------------------

function TrailBit({ kind }: { kind: string }) {
  switch (kind) {
    case "trail.hearts":
      return (
        <svg viewBox="0 0 10 10" width="10" height="10">
          <path d="M5 9 L1.2 5.2 A2.2 2.2 0 0 1 5 2.4 A2.2 2.2 0 0 1 8.8 5.2 Z" fill="#ff6b9a" stroke="#d63a6c" strokeWidth="0.5" />
          <circle cx="3.3" cy="3.8" r="0.7" fill="#fff" opacity="0.8" />
        </svg>
      );
    case "trail.stars":
      return (
        <svg viewBox="0 0 10 10" width="10" height="10">
          <Star x={5} y={5} r={4.6} fill="#fff3a0" />
          <circle cx="5" cy="5" r="1.2" fill="#fff" />
        </svg>
      );
    case "trail.sparkle":
      return (
        <svg viewBox="0 0 10 10" width="9" height="9">
          <Star x={5} y={5} r={4.8} fill="#ffd23f" />
          <Star x={5} y={5} r={2} fill="#fff8d0" />
        </svg>
      );
    case "trail.notes":
      return (
        <svg viewBox="0 0 12 12" width="11" height="11">
          <path d="M4 9.5 L4 2.5 L10.5 1 L10.5 8" fill="none" stroke="#e8f2fb" strokeWidth="1.2" />
          <ellipse cx="2.8" cy="9.6" rx="1.9" ry="1.4" fill="#e8f2fb" />
          <ellipse cx="9.3" cy="8.1" rx="1.9" ry="1.4" fill="#e8f2fb" />
        </svg>
      );
    case "trail.ink":
      return <span className="trail-ink" />;
    case "trail.fire":
    case "trail.flame": {
      const [outer, inner] = kind === "trail.fire" ? ["#ff6a2b", "#ffd166"] : ["#3fa6ff", "#e6f6ff"];
      // Flames point backwards (left), away from the sub.
      return (
        <svg viewBox="0 0 12 10" width="13" height="11">
          <path d="M11 5 C 11 1.5, 7 0.5, 1 2.5 C 4 3.5, 3 4.5, 0.5 5 C 3 5.5, 4 6.5, 1 7.5 C 7 9.5, 11 8.5, 11 5 Z" fill={outer} />
          <path d="M10.5 5 C 10.5 3.2, 8 2.6, 4.5 3.8 C 6 4.4, 6 5.6, 4.5 6.2 C 8 7.4, 10.5 6.8, 10.5 5 Z" fill={inner} />
        </svg>
      );
    }
    default:
      return <span className="trail-bubble" />;
  }
}

// Each bit leaves the propeller and fans out evenly above and below it.
const TRAIL_PATHS = [
  { dy: -3, dx: -52 },
  { dy: 9, dx: -46 },
  { dy: -11, dx: -44 },
  { dy: 3, dx: -56 },
  { dy: -6, dx: -40 },
  { dy: 12, dx: -50 },
  { dy: -14, dx: -54 },
  { dy: 6, dx: -42 },
];

/** What streams out behind a sub, from the propeller (pure CSS, so it's cheap). */
export function Trail({ kind }: { kind: string }) {
  if (kind === "trail.rainbow") {
    return (
      <span className="trail trail--rainbow" aria-hidden="true">
        {RAINBOW.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </span>
    );
  }
  const name = kind.split(".")[1];
  const spin = kind === "trail.stars" || kind === "trail.sparkle";
  return (
    <span className={`trail trail--${name}`} aria-hidden="true">
      {TRAIL_PATHS.map((t, i) => (
        <span
          key={i}
          className={`trail-bit ${spin ? "trail-bit--spin" : ""}`}
          style={{ animationDelay: `${(i * 1.6) / TRAIL_PATHS.length}s`, "--dx": `${t.dx}px`, "--dy": `${t.dy}px` } as CSSProperties}
        >
          <TrailBit kind={kind} />
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sidekicks
// ---------------------------------------------------------------------------

/** A shiny cartoon eye (white, pupil, glint). */
function Eye({ x, y, r = 1.6 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#fff" />
      <circle cx={x + r * 0.2} cy={y + r * 0.1} r={r * 0.6} fill="#15161c" />
      <circle cx={x - r * 0.1} cy={y - r * 0.25} r={r * 0.25} fill="#fff" />
    </g>
  );
}

export function BuddyArt({ kind, size = 22 }: { kind: string; size?: number }) {
  const uid = useId().replace(/:/g, "");
  const s = { width: size, height: size, className: "buddy-svg" };
  switch (kind) {
    case "buddy.fish": {
      // Body drawn last so the tail and fins tuck in behind it; stripes clipped to the body.
      const body = "M5.5 10 C 5.5 5.5, 10 3.7, 15 3.7 C 21 3.7, 25.5 6.5, 25.5 10 C 25.5 13.5, 21 16.3, 15 16.3 C 10 16.3, 5.5 14.5, 5.5 10 Z";
      return (
        <svg viewBox="0 0 28 20" {...s}>
          <defs>
            <clipPath id={`cf-${uid}`}>
              <path d={body} />
            </clipPath>
          </defs>
          <path d="M7.5 10 C 5 6.5, 2.5 4.6, 1.2 5.4 C 2.6 8, 2.6 12, 1.2 14.6 C 2.5 15.4, 5 13.5, 7.5 10 Z" fill="#ff8a2e" stroke="#1b1b1b" strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M1.6 6 C 2.6 8.3, 2.6 11.7, 1.6 14" stroke="#1b1b1b" strokeWidth="0.9" fill="none" />
          <path d="M10.5 4.6 C 12 0.8, 18 0.6, 20 4.4 Z" fill="#ff8a2e" stroke="#1b1b1b" strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M12 15.5 C 13 18.6, 16.5 18.8, 17.5 15.8 Z" fill="#ff8a2e" stroke="#1b1b1b" strokeWidth="0.7" strokeLinejoin="round" />
          <path d={body} fill="#ff8a2e" />
          <g clipPath={`url(#cf-${uid})`}>
            {[[10, 1.5], [16, 1.4], [21.4, 0.9]].map(([x, w]) => (
              <path key={x} d={`M${x - w} 2 Q ${x - w - 1} 10, ${x - w} 18 L ${x + w} 18 Q ${x + w - 1} 10, ${x + w} 2 Z`} fill="#fff" stroke="#1b1b1b" strokeWidth="0.7" />
            ))}
            <path d="M5 14 C 12 18, 20 18, 26 13.5 L 26 20 L 5 20 Z" fill="#c75a00" opacity="0.25" />
          </g>
          <path d={body} fill="none" stroke="#1b1b1b" strokeWidth="0.8" />
          <path d="M10 5.8 Q 14 4.6, 18 5.2" stroke="#fff" strokeWidth="0.9" fill="none" opacity="0.5" strokeLinecap="round" />
          <Eye x={23} y={8.6} r={1.5} />
          <path d="M24.4 12 Q 25.2 12.5, 25.4 11.6" stroke="#7a2e00" strokeWidth="0.6" fill="none" strokeLinecap="round" />
        </svg>
      );
    }
    case "buddy.crab":
      return (
        <svg viewBox="0 0 30 22" {...s}>
          <path d="M8 16 L5 20 M11 17.5 L9.5 21 M19 17.5 L20.5 21 M22 16 L25 20" stroke="#c23b3b" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M8.5 11 Q 5 9, 4.5 6.5 M21.5 11 Q 25 9, 25.5 6.5" stroke="#e04848" strokeWidth="2" fill="none" strokeLinecap="round" />
          {/* pincers */}
          <path d="M4.5 7.5 C 1 7, 0.5 2.5, 3.5 1.5 L 4 4.5 L 6.5 2.5 C 7.5 5, 6.5 7.5, 4.5 7.5 Z" fill="#ff5e5e" stroke="#b02c2c" strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M25.5 7.5 C 29 7, 29.5 2.5, 26.5 1.5 L 26 4.5 L 23.5 2.5 C 22.5 5, 23.5 7.5, 25.5 7.5 Z" fill="#ff5e5e" stroke="#b02c2c" strokeWidth="0.7" strokeLinejoin="round" />
          <ellipse cx="15" cy="13.5" rx="8.5" ry="5.5" fill="#ff5e5e" stroke="#b02c2c" strokeWidth="0.9" />
          <path d="M9.5 11.5 Q 15 9, 20.5 11.5" stroke="#fff" strokeWidth="1" fill="none" opacity="0.4" strokeLinecap="round" />
          <path d="M12.5 9.5 L12.5 6.5 M17.5 9.5 L17.5 6.5" stroke="#b02c2c" strokeWidth="1" />
          <Eye x={12.5} y={6} r={1.6} />
          <Eye x={17.5} y={6} r={1.6} />
          <path d="M13.5 14.5 Q 15 15.8, 16.5 14.5" stroke="#7a1a1a" strokeWidth="0.8" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "buddy.jelly":
      return (
        <svg viewBox="0 0 22 28" {...s}>
          <ellipse cx="11" cy="9" rx="10" ry="8" fill="#d79bff" opacity="0.3" />
          {[5, 8.5, 12, 15.5].map((x, i) => (
            <path
              key={x}
              className="jelly-tentacle"
              style={{ animationDelay: `${i * 0.2}s` }}
              d={`M${x} 12 C ${x - 2} 16, ${x + 2} 20, ${x} 26`}
              stroke="#c784ff"
              strokeWidth="1.3"
              fill="none"
              strokeLinecap="round"
            />
          ))}
          <path d="M2.5 11.5 C 2.5 4, 8 1.5, 11 1.5 C 14 1.5, 19.5 4, 19.5 11.5 Q 17 13, 15 11.5 Q 13 13, 11 11.5 Q 9 13, 7 11.5 Q 5 13, 2.5 11.5 Z" fill="#dba5ff" stroke="#9b55e0" strokeWidth="0.8" />
          <path d="M5.5 6.5 Q 7.5 3.5, 10.5 3.2" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.7" />
          <circle cx="8.5" cy="8.5" r="0.9" fill="#3a1757" />
          <circle cx="13.5" cy="8.5" r="0.9" fill="#3a1757" />
          <path d="M9.8 10 Q 11 10.8, 12.2 10" stroke="#3a1757" strokeWidth="0.6" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "buddy.seahorse": {
      // One continuous curve (outline drawn underneath), so head, body and tail read as one animal.
      const spine = "M10.5 7 C 15.5 9, 16 15.5, 12 18.5 C 9 20.8, 9 24, 11.5 24.6 C 13.6 25.1, 14.2 22.6, 12.4 22.2";
      return (
        <svg viewBox="0 0 20 28" {...s}>
          <path d="M14.2 11 C 17.5 11, 18.5 14, 16.6 16.2 Z" fill="#ff8a3d" stroke="#b8701a" strokeWidth="0.6" strokeLinejoin="round" />
          <path d={spine} stroke="#b8701a" strokeWidth="6.4" fill="none" strokeLinecap="round" />
          <path d={spine} stroke="#ffb347" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M9.3 10 C 12.5 12, 12.6 16, 10.6 18" stroke="#ffd79a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          {[11.5, 14, 16.5].map((y) => (
            <path key={y} d={`M${10.4 + (y - 11.5) * 0.25} ${y} l 3.3 -0.4`} stroke="#d98a2a" strokeWidth="0.6" strokeLinecap="round" opacity="0.8" />
          ))}
          {/* head and snout */}
          <path d="M8.8 5.8 L 3 5.4 Q 1.6 6.4, 3 7.6 L 8.8 8.4 Z" fill="#ffb347" stroke="#b8701a" strokeWidth="0.7" strokeLinejoin="round" />
          <circle cx="10.5" cy="6.5" r="3.8" fill="#ffb347" stroke="#b8701a" strokeWidth="0.7" />
          <path d="M10.5 6.5 L 7.5 6.9" stroke="#ffb347" strokeWidth="2" />
          <path d="M10 2.9 L 10.8 0.6 L 12 2.9 M12.6 3.6 L 14.5 2 L 14.2 4.4" fill="#ff8a3d" stroke="#b8701a" strokeWidth="0.6" strokeLinejoin="round" />
          <Eye x={11} y={5.8} r={1.3} />
        </svg>
      );
    }
    case "buddy.octopus":
      return (
        <svg viewBox="0 0 26 26" {...s}>
          {[3.5, 7.5, 11.5, 15.5, 19.5, 22.5].map((x, i) => (
            <path
              key={x}
              d={`M${13 + (x - 13) * 0.55} 14 C ${x - 1.5} 18, ${x + 2} 20.5, ${x} 24 Q ${x + 1.2} 25, ${x + 1.8} 23.4`}
              stroke="#ff6aa9"
              strokeWidth="2.6"
              fill="none"
              strokeLinecap="round"
              className="octo-arm"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
          <path d="M3.5 12.5 C 3.5 4.5, 8 1, 13 1 C 18 1, 22.5 4.5, 22.5 12.5 C 22.5 16, 18 17, 13 17 C 8 17, 3.5 16, 3.5 12.5 Z" fill="#ff7bb5" stroke="#cf3f82" strokeWidth="0.9" />
          <path d="M7 6.5 Q 9 3.5, 12.5 3.2" stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" opacity="0.6" />
          <circle cx="8" cy="12.5" r="1.4" fill="#ff4f97" opacity="0.6" />
          <circle cx="18" cy="12.5" r="1.4" fill="#ff4f97" opacity="0.6" />
          <Eye x={10} y={10} r={2} />
          <Eye x={16} y={10} r={2} />
          <path d="M11.5 13.8 Q 13 15, 14.5 13.8" stroke="#7a1243" strokeWidth="0.8" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "buddy.turtle":
      return (
        <svg viewBox="0 0 30 20" {...s}>
          {/* flippers */}
          <path d="M8 13 Q 3 17, 4 19 Q 7 18, 10 15 Z M8 7 Q 3 3, 4 1 Q 7 2, 10 5 Z" fill="#7fd08e" stroke="#3f8a4f" strokeWidth="0.7" />
          <path d="M18 14 Q 22 19, 24 18.5 Q 23.5 16, 20 13 Z M18 6 Q 22 1, 24 1.5 Q 23.5 4, 20 7 Z" fill="#7fd08e" stroke="#3f8a4f" strokeWidth="0.7" />
          <path d="M5 10 L1.5 9 L1.5 11 Z" fill="#7fd08e" />
          {/* head */}
          <ellipse cx="25" cy="10" rx="3.8" ry="3" fill="#8fdc9c" stroke="#3f8a4f" strokeWidth="0.7" />
          <Eye x={26.2} y={9.2} r={1.1} />
          <path d="M26.5 11.4 Q 27.5 11.9, 28.2 11.2" stroke="#2c5e36" strokeWidth="0.5" fill="none" />
          {/* shell */}
          <ellipse cx="14" cy="10" rx="9" ry="6.5" fill="#3e9a57" stroke="#245e34" strokeWidth="0.9" />
          <path d="M10 7 L14 5 L18 7 L18 13 L14 15 L10 13 Z" fill="#2f7d47" stroke="#6fc183" strokeWidth="0.6" />
          <path d="M14 5 L14 3.6 M18 7 L22 6 M18 13 L22 14 M14 15 L14 16.4 M10 13 L6 14 M10 7 L6 6" stroke="#6fc183" strokeWidth="0.6" />
          <path d="M8 6.5 Q 11 4, 14 3.8" stroke="#fff" strokeWidth="0.9" fill="none" strokeLinecap="round" opacity="0.4" />
        </svg>
      );
    case "buddy.narwhal":
      return (
        <svg viewBox="0 0 34 20" {...s}>
          <path d="M2 7 Q 5 9.5, 7 11 Q 5 12.5, 2 15 Q 3.5 11, 2 7 Z" fill="#7aa4cf" stroke="#4a6f94" strokeWidth="0.7" />
          <path d="M6 11 C 6 6, 12 4.5, 18 4.5 C 24 4.5, 27 8, 27 11.5 C 27 15.5, 22 17.5, 16 17.5 C 10 17.5, 6 15, 6 11 Z" fill="#9cc1e6" stroke="#4a6f94" strokeWidth="0.8" />
          <path d="M8 13.5 C 13 17, 21 17, 26 13.5 C 25 16.5, 20 17.5, 16 17.5 C 11 17.5, 8.5 16, 8 13.5 Z" fill="#e3f0ff" />
          {[10, 14, 18].map((x) => (
            <circle key={x} cx={x} cy={8 + (x % 3)} r="0.7" fill="#6d93ba" />
          ))}
          <path d="M14 15 Q 16 17.5, 18 15.5" fill="#7aa4cf" />
          <path d="M26 7.5 L33 1.5" stroke="#fff3cf" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M27.5 6.4 L28.6 5.8 M29.4 4.9 L30.5 4.2 M31.2 3.4 L32 2.9" stroke="#c9b27a" strokeWidth="0.6" />
          <Eye x={22.5} y={9.5} r={1.3} />
          <path d="M23.5 12.5 Q 24.8 13.2, 25.8 12.3" stroke="#4a6f94" strokeWidth="0.6" fill="none" />
        </svg>
      );
    case "buddy.angler": {
      const body = "M6 13 C 6 7.5, 10.5 4.5, 16 4.5 C 22 4.5, 26 8.5, 26 13 C 26 18, 21.5 21, 16 21 C 10.5 21, 6 18.5, 6 13 Z";
      return (
        <svg viewBox="0 0 30 24" {...s}>
          <defs>
            <clipPath id={`an-${uid}`}>
              <path d={body} />
            </clipPath>
          </defs>
          {/* lure on a stalk from the top of the head */}
          <path d="M15 5 C 15 -0.5, 23 -1, 25.5 3.2" stroke="#2b3846" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <circle cx="26" cy="4.6" r="4.2" fill="#fff07a" opacity="0.28" className="buddy-glow" />
          <circle cx="26" cy="4.6" r="2" fill="#fff07a" className="buddy-glow" />
          {/* tail fan tucked behind the body */}
          <path d="M8 13 C 5 9.5, 2.5 8, 1.2 8.8 C 2.4 11.3, 2.4 14.7, 1.2 17.2 C 2.5 18, 5 16.5, 8 13 Z" fill="#3a4a5a" stroke="#1d2731" strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M9.5 19 C 9.5 22, 13 23, 14 20 Z" fill="#3a4a5a" stroke="#1d2731" strokeWidth="0.6" />
          <path d={body} fill="#4a5e72" />
          <g clipPath={`url(#an-${uid})`}>
            {/* wide grumpy mouth across the front */}
            <path d="M14 15 Q 20 18.5, 27 12.5 L 27 22 L 14 22 Z" fill="#1a1f26" />
            <path d="M15.5 15.9 L16.4 14.3 L17.3 16.5 L18.4 14.7 L19.4 16.6 L20.5 14.6 L21.5 16.1 L22.6 13.9 L23.5 15.3 L24.6 13" stroke="#fff" strokeWidth="0.7" fill="none" strokeLinejoin="round" />
            <path d="M5 17 C 12 22, 20 22, 27 17 L 27 24 L 5 24 Z" fill="#000" opacity="0.15" />
          </g>
          <path d={body} fill="none" stroke="#1d2731" strokeWidth="0.9" />
          <path d="M9.5 9 Q 12.5 6.6, 16 6.4" stroke="#fff" strokeWidth="1" fill="none" opacity="0.25" strokeLinecap="round" />
          <circle cx="19.5" cy="10.5" r="2.4" fill="#fff07a" stroke="#1d2731" strokeWidth="0.5" />
          <circle cx="19.9" cy="10.7" r="1.1" fill="#15161c" />
          <path d="M17 7.6 L 21.5 8.4" stroke="#1d2731" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      );
    }
    case "buddy.whale":
      return (
        <svg viewBox="0 0 34 22" {...s}>
          <path className="whale-spout" d="M21 4 C 19.5 0.5, 22.5 0, 21.5 2.5 M21 4 C 22.5 0.5, 25 1.5, 23 3" stroke="#bfe9ff" strokeWidth="1" fill="none" strokeLinecap="round" />
          <path d="M1.5 5 Q 4.5 9, 6 11.5 Q 4 13, 1.5 16 Q 2 11, 1.5 5 Z" fill="#3f6fae" stroke="#2a4c7a" strokeWidth="0.7" />
          <path d="M5 12 C 5 6.5, 13 4.5, 21 4.5 C 28 4.5, 32 8.5, 32 12.5 C 32 17, 26 19.5, 18 19.5 C 10 19.5, 5 17, 5 12 Z" fill="#4f84c7" stroke="#2a4c7a" strokeWidth="0.9" />
          <path d="M8 14.5 C 14 19, 25 19, 31 14 C 30 17.5, 25 19.5, 18 19.5 C 12 19.5, 8.5 17.5, 8 14.5 Z" fill="#cfe6ff" />
          {[12, 15, 18, 21, 24].map((x) => (
            <path key={x} d={`M${x} 15.5 L${x + 0.5} 18.5`} stroke="#9cc4ec" strokeWidth="0.5" />
          ))}
          <path d="M9.5 8.5 Q 14 6, 19 6" stroke="#fff" strokeWidth="1.1" fill="none" opacity="0.35" strokeLinecap="round" />
          <path d="M15 14 Q 17 17.5, 20 15.5 Z" fill="#3f6fae" />
          <Eye x={25.5} y={11} r={1.3} />
          <path d="M27.5 13.8 Q 29 14.6, 30.2 13.4" stroke="#2a4c7a" strokeWidth="0.6" fill="none" strokeLinecap="round" />
          <circle cx="27.5" cy="12.8" r="0.9" fill="#ff9ec0" opacity="0.6" />
        </svg>
      );
    case "buddy.krill": {
      // A curled shrimp: one smooth body (outline drawn underneath) with segment lines, tail fan, legs and long feelers.
      const spine = "M4.5 7.5 C 8 12.5, 17 13.5, 23.5 9";
      return (
        <svg viewBox="0 0 30 18" {...s}>
          <path d="M23.5 8.5 C 26 4, 28.5 2, 29.6 1.6 M23 8 C 24.5 3.5, 26 1.8, 26.8 1" stroke="#d99a00" strokeWidth="0.6" fill="none" strokeLinecap="round" />
          {[9, 12.5, 16, 19.5].map((x) => (
            <path key={x} d={`M${x} ${12.3 - (x - 9) * 0.05} q -1 1.8, -1.6 3.6`} stroke="#d99a00" strokeWidth="0.7" fill="none" strokeLinecap="round" />
          ))}
          <path d="M5 7.8 L 1 4.6 Q 0.4 6.5, 1.4 7.6 Q 0 8.6, 0.8 10.6 Z" fill="#ffc21a" stroke="#c48800" strokeWidth="0.6" strokeLinejoin="round" />
          <path d={spine} stroke="#c48800" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d={spine} stroke="#ffd23f" strokeWidth="5.6" fill="none" strokeLinecap="round" />
          <path d="M6.5 8 C 10 11, 16 11.5, 21.5 8.4" stroke="#fff3b0" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.7" />
          {[8.5, 12, 15.5, 19].map((x) => (
            <path key={x} d={`M${x} ${x < 12 ? 8.4 : 8.9} q 0.9 2.2, 0.4 4.6`} stroke="#c48800" strokeWidth="0.6" fill="none" strokeLinecap="round" opacity="0.75" />
          ))}
          <circle cx="24" cy="8.3" r="1.25" fill="#2a1d00" />
          <circle cx="23.7" cy="7.9" r="0.4" fill="#fff" />
        </svg>
      );
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// A full rig: sub + trail + sidekick
// ---------------------------------------------------------------------------

/** A diver's sub with their trail and sidekick. Leave `look` out to use your own. */
export function SubRig({ look, hue, width = 46, trail = true }: { look?: Look; hue?: number; width?: number; trail?: boolean }) {
  const mine = useMyLook();
  const l: Look = look ?? (hue === undefined ? mine : {});
  const trailKind = l.trail ?? DEFAULT_LOOK.trail;
  const buddy = l.buddy && l.buddy !== DEFAULT_LOOK.buddy ? l.buddy : null;
  return (
    <span className="sub-rig">
      {trail && trailKind !== DEFAULT_LOOK.trail && <Trail kind={trailKind} />}
      <SubArt skin={l.skin} hue={hue} width={width} />
      {buddy && (
        <span className="sub-buddy">
          <BuddyArt kind={buddy} size={Math.round(width * 0.45)} />
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Names and titles
// ---------------------------------------------------------------------------

export function nameStyle(look?: Look): { className?: string; style?: CSSProperties } {
  const c = look?.color ? NAME_COLORS[look.color] : "";
  if (!c) return {};
  if (c === "rainbow") return { className: "name-rainbow" };
  return { style: { color: c } };
}

/** Props for an element that shows a name: keeps its own class and adds the shop colour. */
export function withName(base: string, look?: Look): { className: string; style?: CSSProperties } {
  const ns = nameStyle(look);
  return { className: ns.className ? `${base} ${ns.className}` : base, style: ns.style };
}

/** A player's name in their shop colour, with their title underneath (or beside it, inline). */
export function PlayerName({
  name,
  look,
  inline = false,
  className = "",
  children,
}: {
  name: string;
  look?: Look;
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const title = look?.title ? ITEM_BY_ID.get(look.title)?.name : null;
  const ns = nameStyle(look);
  return (
    <span className={`pname ${inline ? "pname--inline" : ""} ${className}`}>
      <span className="pname-line">
        <span className={ns.className} style={ns.style}>
          {name}
        </span>
        {children}
      </span>
      {title && <span className="ptitle">{title}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ocean colours
// ---------------------------------------------------------------------------

/** [depth, top colour, bottom colour] stops for each ocean. */
export const OCEAN_THEMES: Record<string, [number, string, string][]> = {
  "theme.classic": [
    [0, "#5ccff5", "#0a6fb0"],
    [1000, "#1769b8", "#073a73"],
    [2500, "#0a2c5e", "#03142e"],
    [4000, "#06142c", "#020812"],
    [5500, "#030a17", "#010307"],
    [7000, "#010409", "#000000"],
  ],
  "theme.tropical": [
    [0, "#7ff0e6", "#14b3b8"],
    [1000, "#1fb5b0", "#0a6f86"],
    [2500, "#0b5668", "#032a3a"],
    [4000, "#06303d", "#02121a"],
    [5500, "#031820", "#01080c"],
    [7000, "#01080b", "#000000"],
  ],
  "theme.sunset": [
    [0, "#ffb58a", "#d9577a"],
    [1000, "#b9487a", "#5b2a6e"],
    [2500, "#4a2163", "#1d0d33"],
    [4000, "#231238", "#0b0516"],
    [5500, "#120a1f", "#05020a"],
    [7000, "#06030b", "#000000"],
  ],
  "theme.kelp": [
    [0, "#8fe3a0", "#2a8f5a"],
    [1000, "#2a7f52", "#104a32"],
    [2500, "#0e3d2a", "#041c13"],
    [4000, "#06231a", "#020c08"],
    [5500, "#03120d", "#010604"],
    [7000, "#010604", "#000000"],
  ],
  "theme.arctic": [
    [0, "#e6f7ff", "#8fc9e8"],
    [1000, "#7fb6d8", "#3d7aa8"],
    [2500, "#2f5f88", "#14304d"],
    [4000, "#152f4a", "#081626"],
    [5500, "#0a1828", "#030810"],
    [7000, "#030810", "#000000"],
  ],
  "theme.glow": [
    [0, "#6fe6d8", "#3a6fd9"],
    [1000, "#3b4fc4", "#2a1f7a"],
    [2500, "#2b1a6e", "#12083a"],
    [4000, "#1d0f4a", "#0b0526"],
    [5500, "#140a33", "#080318"],
    [7000, "#0a0420", "#02000a"],
  ],
  "theme.abyss": [
    [0, "#3a6f8f", "#123a55"],
    [1000, "#123248", "#071a29"],
    [2500, "#06131f", "#02070d"],
    [4000, "#03080e", "#010205"],
    [5500, "#010306", "#000000"],
    [7000, "#000000", "#000000"],
  ],
};

export function ThemeSwatch({ theme }: { theme: string }) {
  const stops = OCEAN_THEMES[theme] ?? OCEAN_THEMES["theme.classic"];
  return <span className="theme-swatch" style={{ background: `linear-gradient(180deg, ${stops[0][1]}, ${stops[2][1]} 55%, ${stops[4][2]})` }} />;
}

// ---------------------------------------------------------------------------
// Celebrations
// ---------------------------------------------------------------------------

interface Bit {
  id: number;
  x: number;
  y: number;
  r: number;
  color: string;
  delay: number;
}

const BURST_COLORS: Record<string, string[]> = {
  "burst.sparkle": ["#fff6b0", "#ffd23f", "#ffffff", "#bdefff"],
  "burst.confetti": ["#ff5e5e", "#ffd23f", "#5ec8ff", "#6ee07a", "#c49bff", "#ff9ed2"],
  "burst.bubbles": ["#bdefff", "#e6f8ff", "#9fe0ff"],
  "burst.hearts": ["#ff6b9a", "#ff9ec0", "#ff3d7f"],
  "burst.fireworks": ["#ffd23f", "#ff5e5e", "#5ee6ff", "#a6f05a", "#c49bff"],
  "burst.ink": ["#14121f", "#241f3a", "#0b0a12"],
  "burst.fish": ["#ff8a3d", "#5ec8ff", "#ffd23f", "#6ee07a"],
  "burst.gold": ["#ffd23f", "#ffc21a", "#ffe58a"],
};

function BurstBit({ kind, bit }: { kind: string; bit: Bit }) {
  const common = { position: "absolute" as const, left: "50%", top: "42%" };
  if (kind === "burst.fish") {
    return (
      <motion.span
        style={{ ...common, left: 0, top: `${20 + bit.y * 0.4}%` }}
        initial={{ x: -60, opacity: 0 }}
        animate={{ x: "105vw", opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.6 + bit.r * 0.05, delay: bit.delay, ease: "easeInOut" }}
      >
        <svg viewBox="0 0 24 16" width="26" height="18">
          <path d="M2 8 L7 3 L7 13 Z" fill={bit.color} />
          <ellipse cx="14" cy="8" rx="8" ry="5.5" fill={bit.color} />
          <circle cx="19" cy="7" r="1.2" fill="#1b1b1b" />
        </svg>
      </motion.span>
    );
  }
  if (kind === "burst.fireworks") {
    return (
      <motion.span
        className="burst-ring"
        style={{ ...common, left: `${30 + bit.x * 0.4}%`, top: `${20 + bit.y * 0.3}%`, borderColor: bit.color }}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: 3 + bit.r / 10, opacity: 0 }}
        transition={{ duration: 1.1, delay: bit.delay, ease: "easeOut" }}
      />
    );
  }
  const angle = (bit.x / 100) * Math.PI * 2;
  const dist = 200 + bit.r * 14;
  const fall = kind === "burst.confetti" || kind === "burst.gold";
  const shape =
    kind === "burst.hearts" ? (
      <svg viewBox="0 0 10 10" width="22" height="22">
        <path d="M5 9 L1.2 5.2 A2.2 2.2 0 0 1 5 2.4 A2.2 2.2 0 0 1 8.8 5.2 Z" fill={bit.color} />
      </svg>
    ) : kind === "burst.gold" ? (
      <span className="burst-coin" style={{ background: bit.color }} />
    ) : kind === "burst.confetti" ? (
      <span className="burst-confetti" style={{ background: bit.color }} />
    ) : kind === "burst.sparkle" ? (
      <svg viewBox="0 0 10 10" width={12 + bit.r / 2} height={12 + bit.r / 2}>
        <Star x={5} y={5} r={4.8} fill={bit.color} />
      </svg>
    ) : kind === "burst.ink" ? (
      <span className="burst-ink" style={{ background: bit.color, width: 14 + bit.r, height: 14 + bit.r }} />
    ) : (
      <span className="burst-bubble" style={{ borderColor: bit.color, width: 8 + bit.r / 2, height: 8 + bit.r / 2 }} />
    );
  return (
    <motion.span
      style={common}
      initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
      animate={{
        x: Math.cos(angle) * dist,
        y: fall ? [Math.sin(angle) * dist * 0.6, Math.sin(angle) * dist * 0.6 + 260] : Math.sin(angle) * dist - (kind === "burst.bubbles" ? 120 : 0),
        opacity: [1, 1, 0],
        scale: kind === "burst.ink" ? 2.2 : 1,
        rotate: fall ? 360 + bit.r * 20 : 0,
      }}
      transition={{ duration: fall ? 2.2 : 1.5, delay: bit.delay, ease: "easeOut" }}
    >
      {shape}
    </motion.span>
  );
}

/** Plays your equipped celebration whenever `celebrate()` fires (Rare answers and up). */
export function CelebrationLayer({ reducedMotion }: { reducedMotion: boolean }) {
  const look = useMyLook();
  const [burst, setBurst] = useState<{ key: number; bits: Bit[]; kind: string } | null>(null);
  useEffect(
    () =>
      onCelebrate((tier) => {
        const kind = look.burst;
        if (reducedMotion || !kind) return;
        const n = tier >= 100 ? 64 : tier >= 85 ? 40 : 24;
        const colors = BURST_COLORS[kind] ?? BURST_COLORS["burst.confetti"];
        const count = kind === "burst.fish" ? Math.round(n / 3) : kind === "burst.fireworks" ? Math.round(n / 4) : n;
        const bits = Array.from({ length: count }, (_, i) => ({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          r: Math.random() * 20,
          color: colors[i % colors.length],
          delay: kind === "burst.fireworks" || kind === "burst.fish" ? i * 0.12 : Math.random() * 0.12,
        }));
        setBurst({ key: Date.now(), bits, kind });
        setTimeout(() => setBurst((b) => (b && Date.now() - b.key >= 2900 ? null : b)), 3000);
      }),
    [look.burst, reducedMotion],
  );
  return (
    <div className="celebration-layer" aria-hidden="true">
      <AnimatePresence>
        {burst && (
          <motion.div key={burst.key} className="celebration" exit={{ opacity: 0 }}>
            {burst.bits.map((b) => (
              <BurstBit key={b.id} kind={burst.kind} bit={b} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The small picture on a shop card. */
export function ItemPreview({ item }: { item: ShopItem }) {
  switch (item.slot) {
    case "skin":
      return <SubArt skin={item.id} width={84} />;
    case "trail":
      return (
        <span className="preview-trail">
          <SubRig look={{ trail: item.id }} width={56} />
          {item.id === DEFAULT_LOOK.trail && <Trail kind="trail.bubbles" />}
        </span>
      );
    case "buddy":
      return item.id === DEFAULT_LOOK.buddy ? <span className="preview-none">—</span> : <BuddyArt kind={item.id} size={58} />;
    case "burst":
      return <span className="preview-emoji">{{ "burst.sparkle": "✨", "burst.confetti": "🎊", "burst.bubbles": "🫧", "burst.hearts": "💖", "burst.fireworks": "🎆", "burst.ink": "🦑", "burst.fish": "🐟", "burst.gold": "🪙" }[item.id] ?? "🎉"}</span>;
    case "theme":
      return <ThemeSwatch theme={item.id} />;
    case "title":
      return <span className="ptitle ptitle--big">{item.id === DEFAULT_LOOK.title ? "—" : item.name}</span>;
    case "color": {
      const ns = nameStyle({ color: item.id });
      return (
        <span className={`preview-name ${ns.className ?? ""}`} style={ns.style}>
          Diver
        </span>
      );
    }
  }
}
