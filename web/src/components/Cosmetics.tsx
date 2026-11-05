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

const HULL = "M12 22 C 12 13, 22 11, 36 11 C 52 11, 60 16, 60 22 C 60 28, 52 33, 36 33 C 22 33, 12 31, 12 22 Z";
const TOWER = "M28 11 L30 4 L42 4 L44 11 Z";
const RAINBOW = ["#ff5e5e", "#ffa53d", "#ffe156", "#6ee07a", "#5ec8ff", "#a77bff"];

function Star({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  const d = `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`;
  return <path d={d} fill={fill} />;
}

/** The pattern painted on the hull (clipped to it). */
function HullPattern({ style }: { style: SkinStyle }) {
  const a = style.accent ?? style.dark;
  switch (style.pattern) {
    case "stripes":
      return (
        <g fill={a}>
          {[18, 27, 36, 45, 54].map((x) => (
            <path key={x} d={`M${x} 9 L${x + 4} 9 L${x + 1} 35 L${x - 3} 35 Z`} />
          ))}
        </g>
      );
    case "dots":
      return (
        <g fill={a} opacity="0.9">
          {[
            [18, 16],
            [22, 28],
            [31, 14],
            [33, 29],
            [43, 15],
            [42, 30],
            [53, 18],
            [55, 27],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" />
          ))}
        </g>
      );
    case "teeth":
      return <path d="M44 27 L46.5 31 L49 27 L51.5 31 L54 27 L56.5 30 L59 26.5 L59 33 L44 33 Z" fill={a} stroke={style.dark} strokeWidth="0.8" />;
    case "flames":
      return (
        <path
          d="M12 22 C 18 18, 22 24, 26 17 C 28 22, 32 20, 34 15 C 36 21, 40 22, 42 18 C 42 24, 38 28, 34 29 C 28 31, 18 30, 12 26 Z"
          fill={a}
          opacity="0.95"
        />
      );
    case "stars":
      return (
        <g>
          {[
            [19, 17, 1.6],
            [24, 29, 1.2],
            [33, 15, 1.3],
            [41, 29, 1.7],
            [46, 15, 1.1],
            [55, 21, 1.4],
          ].map(([x, y, r]) => (
            <Star key={`${x}-${y}`} x={x} y={y} r={r} fill={a} />
          ))}
        </g>
      );
    case "scales":
      return (
        <g fill="none" stroke={a} strokeWidth="1" opacity="0.85">
          {[14, 20, 26].map((y, row) =>
            [14, 20, 26, 32, 38, 44, 50, 56].map((x) => <path key={`${x}-${y}`} d={`M${x + (row % 2) * 3 - 3} ${y} a3 3 0 0 0 6 0`} />),
          )}
        </g>
      );
    case "rivets":
      return (
        <g fill={a}>
          <path d="M14 18 L58 18" stroke={style.dark} strokeWidth="0.8" opacity="0.6" />
          <path d="M14 27 L58 27" stroke={style.dark} strokeWidth="0.8" opacity="0.6" />
          {[17, 23, 29, 35, 41, 47, 53].map((x) => (
            <g key={x}>
              <circle cx={x} cy="18" r="0.9" />
              <circle cx={x} cy="27" r="0.9" />
            </g>
          ))}
        </g>
      );
    case "rainbow":
      return (
        <g>
          {RAINBOW.map((c, i) => (
            <rect key={c} x="8" y={10 + i * 4} width="56" height="4.2" fill={c} />
          ))}
        </g>
      );
    default:
      return null;
  }
}

/** A submarine in any paint job, facing right. */
export function SubArt({ skin, hue, width = 46 }: { skin?: string; hue?: number; width?: number }) {
  const clip = useId().replace(/:/g, "");
  const base = SKIN_STYLES[skin ?? DEFAULT_LOOK.skin] ?? SKIN_STYLES[DEFAULT_LOOK.skin];
  // Party colours (for players with no paint job) tint the classic sub.
  const style: SkinStyle = hue !== undefined && !skin ? { body: `hsl(${hue} 75% 62%)`, dark: `hsl(${hue} 60% 38%)`, glass: "#bdefff" } : base;
  const { body, dark, glass } = style;
  const tall = style.pattern === "crown" || style.pattern === "glow" || style.pattern === "spikes";
  return (
    <svg className="sub-svg" width={width} height={width * (tall ? 0.72 : 0.62)} viewBox={tall ? "0 -6 64 46" : "0 0 64 40"} aria-hidden="true">
      <defs>
        <clipPath id={`hull-${clip}`}>
          <path d={HULL} />
        </clipPath>
      </defs>
      {style.pattern === "glow" && (
        <g className="sub-lure">
          <path d="M44 6 C 52 -4, 62 -2, 62 6" fill="none" stroke={dark} strokeWidth="1.4" />
          <circle cx="62" cy="7" r="4.5" fill={style.accent} opacity="0.35" />
          <circle cx="62" cy="7" r="2.4" fill={style.accent} />
        </g>
      )}
      {style.pattern === "spikes" && (
        <g fill={style.accent}>
          {[16, 22, 28, 46, 52].map((x) => (
            <path key={`t${x}`} d={`M${x - 2} 13 L${x} 7.5 L${x + 2} 13 Z`} />
          ))}
          {[18, 26, 34, 42, 50].map((x) => (
            <path key={`b${x}`} d={`M${x - 2} 31.5 L${x} 37 L${x + 2} 31.5 Z`} />
          ))}
        </g>
      )}
      {/* propeller */}
      <g className="sub-prop">
        <ellipse cx="5" cy="22" rx="2.2" ry="7" fill={dark} />
      </g>
      <rect x="6" y="20.5" width="6" height="3" fill={dark} />
      <path d="M10 22 L4 13 L14 17 Z M10 22 L4 31 L14 27 Z" fill={dark} />
      {/* hull and its pattern */}
      <path d={HULL} fill={body} />
      <g clipPath={`url(#hull-${clip})`}>
        <HullPattern style={style} />
      </g>
      <path d={HULL} fill="none" stroke={dark} strokeWidth="1.5" />
      {style.pattern === "teeth" ? (
        <path d="M30 11 L37 1.5 L43 11 Z" fill={body} stroke={dark} strokeWidth="1.5" />
      ) : (
        <>
          <path d={TOWER} fill={style.pattern === "rainbow" ? RAINBOW[5] : body} stroke={dark} strokeWidth="1.5" />
          <path d="M38 4 L38 0.5 L44 0.5" fill="none" stroke={dark} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {style.pattern === "crown" && (
        <path d="M29 4 L30 -4 L33 0 L36 -5 L39 0 L42 -4 L43 4 Z" fill={style.accent} stroke={dark} strokeWidth="0.8" />
      )}
      {/* portholes */}
      {[26, 37, 48].map((x) => (
        <g key={x}>
          <circle cx={x} cy="22" r="3.6" fill={glass} stroke={dark} strokeWidth="1.4" className={style.pattern === "glow" ? "sub-window-glow" : undefined} />
          <circle cx={x - 1} cy="21" r="1.1" fill="#fff" />
        </g>
      ))}
      {style.pattern === "teeth" && <circle cx="56" cy="19" r="1.4" fill={dark} />}
      {!style.pattern && <path d="M16 28 C 26 30.5, 46 30.5, 57 27" fill="none" stroke={dark} strokeWidth="1.2" opacity="0.6" />}
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
        <svg viewBox="0 0 10 10" width="9" height="9">
          <path d="M5 9 L1.2 5.2 A2.2 2.2 0 0 1 5 2.4 A2.2 2.2 0 0 1 8.8 5.2 Z" fill="#ff6b9a" />
        </svg>
      );
    case "trail.stars":
      return (
        <svg viewBox="0 0 10 10" width="9" height="9">
          <Star x={5} y={5} r={4.5} fill="#fff3a0" />
        </svg>
      );
    case "trail.sparkle":
      return (
        <svg viewBox="0 0 10 10" width="8" height="8">
          <Star x={5} y={5} r={4.5} fill="#ffd23f" />
        </svg>
      );
    case "trail.notes":
      return (
        <svg viewBox="0 0 10 12" width="8" height="10">
          <path d="M7 1 L7 8.5 A2 1.6 0 1 1 5.6 7 L5.6 3 L3 3.8 L3 1.8 Z" fill="#e8f2fb" />
        </svg>
      );
    case "trail.ink":
      return <span className="trail-ink" />;
    case "trail.fire":
      return (
        <svg viewBox="0 0 10 12" width="9" height="11">
          <path d="M5 11 C 1 11, 0.5 7, 3 4 C 3 6, 4.5 6.5, 4.5 6.5 C 4 4, 5 2, 7 1 C 6.5 4, 9.5 5.5, 9 8 C 8.6 10, 7 11, 5 11 Z" fill="#ff7a2b" />
          <path d="M5 11 C 3.4 11, 3.2 9, 4.4 7.8 C 4.6 9, 6 9, 6.4 8 C 7.2 9.4, 6.4 11, 5 11 Z" fill="#ffd166" />
        </svg>
      );
    case "trail.flame":
      return (
        <svg viewBox="0 0 10 12" width="9" height="11">
          <path d="M5 11 C 1 11, 0.5 7, 3 4 C 3 6, 4.5 6.5, 4.5 6.5 C 4 4, 5 2, 7 1 C 6.5 4, 9.5 5.5, 9 8 C 8.6 10, 7 11, 5 11 Z" fill="#4fb3ff" />
          <path d="M5 11 C 3.4 11, 3.2 9, 4.4 7.8 C 4.6 9, 6 9, 6.4 8 C 7.2 9.4, 6.4 11, 5 11 Z" fill="#e6f6ff" />
        </svg>
      );
    default:
      return <span className="trail-bubble" />;
  }
}

/** What streams out behind a sub. Six bits on a loop, staggered (pure CSS, so it's cheap). */
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
  return (
    <span className={`trail trail--${kind.split(".")[1]}`} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="trail-bit" style={{ animationDelay: `${i * 0.27}s`, top: `${30 + ((i * 37) % 40)}%` }}>
          <TrailBit kind={kind} />
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sidekicks
// ---------------------------------------------------------------------------

export function BuddyArt({ kind, size = 22 }: { kind: string; size?: number }) {
  const s = { width: size, height: size };
  switch (kind) {
    case "buddy.fish":
      return (
        <svg viewBox="0 0 24 16" {...s}>
          <path d="M2 8 L7 3 L7 13 Z" fill="#ff8a3d" />
          <ellipse cx="14" cy="8" rx="8" ry="5.5" fill="#ff8a3d" />
          <path d="M11 3 C 12 6, 12 10, 11 13" stroke="#fff" strokeWidth="1.8" fill="none" />
          <path d="M16 2.8 C 17 6, 17 10, 16 13.2" stroke="#fff" strokeWidth="1.6" fill="none" />
          <circle cx="19" cy="7" r="1.2" fill="#1b1b1b" />
        </svg>
      );
    case "buddy.crab":
      return (
        <svg viewBox="0 0 24 18" {...s}>
          <ellipse cx="12" cy="11" rx="7" ry="4.5" fill="#ff5e5e" />
          <path d="M5 9 L2 5 M19 9 L22 5" stroke="#ff5e5e" strokeWidth="2" strokeLinecap="round" />
          <circle cx="2.5" cy="4.5" r="2" fill="#ff5e5e" />
          <circle cx="21.5" cy="4.5" r="2" fill="#ff5e5e" />
          <path d="M7 14 L5 17 M10 15 L9 17.5 M14 15 L15 17.5 M17 14 L19 17" stroke="#c23b3b" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="10" cy="8" r="1.1" fill="#fff" />
          <circle cx="14" cy="8" r="1.1" fill="#fff" />
        </svg>
      );
    case "buddy.jelly":
      return (
        <svg viewBox="0 0 20 24" {...s}>
          <path d="M2 10 A8 8 0 0 1 18 10 L18 11 L2 11 Z" fill="#d79bff" opacity="0.9" />
          {[4, 8, 12, 16].map((x) => (
            <path key={x} d={`M${x} 11 C ${x - 1.5} 15, ${x + 1.5} 18, ${x} 23`} stroke="#d79bff" strokeWidth="1.2" fill="none" opacity="0.8" />
          ))}
          <circle cx="7" cy="7" r="1.6" fill="#fff" opacity="0.7" />
        </svg>
      );
    case "buddy.seahorse":
      return (
        <svg viewBox="0 0 16 24" {...s}>
          <path d="M9 2 C 14 2, 14 8, 10 9 C 13 11, 13 16, 9 18 C 7 19, 7 22, 9 22 C 6 23, 4 20, 6 17 C 8 14, 7 12, 5 11 C 3 10, 4 7, 6 6 L3 5 Z" fill="#ffb347" />
          <circle cx="9.5" cy="4.5" r="1" fill="#2b1600" />
        </svg>
      );
    case "buddy.octopus":
      return (
        <svg viewBox="0 0 22 22" {...s}>
          <ellipse cx="11" cy="8" rx="7" ry="6.5" fill="#ff7bb5" />
          {[3, 7, 11, 15, 19].map((x) => (
            <path key={x} d={`M${x} 12 C ${x - 1} 16, ${x + 2} 18, ${x} 21`} stroke="#ff7bb5" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          ))}
          <circle cx="8.5" cy="8" r="1.4" fill="#fff" />
          <circle cx="13.5" cy="8" r="1.4" fill="#fff" />
          <circle cx="8.8" cy="8.2" r="0.7" fill="#222" />
          <circle cx="13.8" cy="8.2" r="0.7" fill="#222" />
        </svg>
      );
    case "buddy.turtle":
      return (
        <svg viewBox="0 0 26 16" {...s}>
          <ellipse cx="12" cy="9" rx="8" ry="5" fill="#4caf6a" />
          <path d="M8 6 L12 4.5 L16 6 L16 11 L12 12.5 L8 11 Z" fill="#2f7d47" />
          <ellipse cx="22" cy="8" rx="3" ry="2.3" fill="#7fd08e" />
          <path d="M6 12 L3 15 M17 12 L19 15 M6 6 L3 3 M17 6 L20 3" stroke="#7fd08e" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="23" cy="7.5" r="0.7" fill="#222" />
        </svg>
      );
    case "buddy.narwhal":
      return (
        <svg viewBox="0 0 30 16" {...s}>
          <path d="M2 6 L6 9 L2 12 Z" fill="#8fb4d9" />
          <ellipse cx="14" cy="9" rx="9" ry="5" fill="#8fb4d9" />
          <path d="M22 7 L29 2" stroke="#fff6d6" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="19" cy="8" r="0.9" fill="#1e2c3a" />
          <path d="M9 13 C 12 14.5, 16 14.5, 19 13" stroke="#dfeeff" strokeWidth="1.2" fill="none" />
        </svg>
      );
    case "buddy.angler":
      return (
        <svg viewBox="0 0 26 20" {...s}>
          <path d="M14 6 C 16 0, 23 0, 23 4" stroke="#3a4a5a" strokeWidth="1.2" fill="none" />
          <circle cx="23" cy="4.5" r="2.2" fill="#fff07a" className="buddy-glow" />
          <path d="M2 12 L6 8 L6 16 Z" fill="#3a4a5a" />
          <ellipse cx="13" cy="12" rx="8" ry="6" fill="#3a4a5a" />
          <path d="M16 14 L17 16 L18 14 L19 16 L20 13.5" stroke="#fff" strokeWidth="0.8" fill="none" />
          <circle cx="17" cy="10" r="1.3" fill="#fff07a" />
        </svg>
      );
    case "buddy.whale":
      return (
        <svg viewBox="0 0 30 18" {...s}>
          <path d="M2 4 L6 9 L2 12 Z" fill="#4f7fbf" />
          <path d="M5 10 C 5 4, 14 3, 21 4 C 27 5, 29 9, 28 12 C 27 15, 20 16, 13 15 C 8 14, 5 13, 5 10 Z" fill="#4f7fbf" />
          <path d="M9 13 C 15 15, 23 15, 27 12" stroke="#bfe0ff" strokeWidth="1.5" fill="none" />
          <circle cx="23" cy="8.5" r="0.9" fill="#0d1a2b" />
          <path d="M18 3 C 17 0, 20 0, 19 2" stroke="#bfe9ff" strokeWidth="1" fill="none" />
        </svg>
      );
    case "buddy.krill":
      return (
        <svg viewBox="0 0 26 14" {...s}>
          <path d="M3 7 C 6 2, 16 1, 22 5 C 24 6, 24 8, 22 9 C 16 13, 6 12, 3 7 Z" fill="#ffd23f" />
          {[8, 12, 16].map((x) => (
            <path key={x} d={`M${x} 10 L${x - 1} 13.5`} stroke="#e0a800" strokeWidth="1" />
          ))}
          <path d="M22 5 C 25 2, 26 1, 26 0.5" stroke="#e0a800" strokeWidth="0.8" fill="none" />
          <circle cx="20" cy="6" r="0.9" fill="#3a2a00" />
          <path d="M3 7 L0.5 4.5 M3 7 L0.5 9.5" stroke="#e0a800" strokeWidth="1" />
        </svg>
      );
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
      return <SubArt skin={item.id} width={64} />;
    case "trail":
      return (
        <span className="preview-trail">
          <SubRig look={{ trail: item.id }} width={44} />
          {item.id === DEFAULT_LOOK.trail && <Trail kind="trail.bubbles" />}
        </span>
      );
    case "buddy":
      return item.id === DEFAULT_LOOK.buddy ? <span className="preview-none">—</span> : <BuddyArt kind={item.id} size={40} />;
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
