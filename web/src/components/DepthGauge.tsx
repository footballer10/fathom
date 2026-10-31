import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import type { MotionValue } from "framer-motion";
import { useState } from "react";
import { ZONES, formatDepth, zoneForDepth } from "@fathom/shared";

/** Bottom of the gauge: a perfect game (700 points). */
export const GAUGE_MAX_DEPTH = 7000;

/** Another diver in a party Dive, shown as their own submarine on the gauge. */
export interface GaugeDiver {
  id: string;
  name: string;
  depth: number;
  hue: number;
}

function useDepthText(depth: MotionValue<number>) {
  const [text, setText] = useState(() => formatDepth(depth.get()));
  const [zone, setZone] = useState(() => zoneForDepth(depth.get()).name);
  useMotionValueEvent(depth, "change", (d) => {
    setText(formatDepth(d));
    setZone(zoneForDepth(d).name);
  });
  return { text, zone };
}

const pct = (d: number) => `${Math.min(100, Math.max(0, (d / GAUGE_MAX_DEPTH) * 100))}%`;

/**
 * Vertical gauge (wide screens): zone names on the left of the line, your
 * submarine (and in a party Dive, everyone else's) on the right.
 */
export function DepthGauge({ depth, others = [] }: { depth: MotionValue<number>; others?: GaugeDiver[] }) {
  const top = useTransform(depth, (d) => pct(d));
  const { text, zone } = useDepthText(depth);

  return (
    <aside className="gauge" aria-label={`Depth ${text}, ${zone}`}>
      <div className="gauge-labels">
        {ZONES.map((z) => (
          <div key={z.name} className="gauge-mark" style={{ top: pct(z.minDepth) }}>
            <span className="gauge-mark-label">{z.name.replace(" Zone", "")}</span>
            <span className="gauge-mark-depth">{z.minDepth.toLocaleString("en-US")} m</span>
          </div>
        ))}
      </div>
      <div className="gauge-track">
        {ZONES.map((z) => (
          <span key={z.name} className="gauge-tick" style={{ top: pct(z.minDepth) }} />
        ))}
        <motion.div className="gauge-fill" style={{ height: top }} />
      </div>
      {others.map((o) => (
        <div key={o.id} className="gauge-sub gauge-sub--other" style={{ top: pct(o.depth) }} title={`${o.name}: ${formatDepth(o.depth)}`}>
          <Submarine hue={o.hue} />
          <span className="gauge-sub-name">{o.name}</span>
        </div>
      ))}
      <motion.div className="gauge-sub gauge-sub--you" style={{ top }}>
        <Submarine />
        <span className="gauge-readout">{text}</span>
      </motion.div>
    </aside>
  );
}

/** Compact depth readout for phones, where the vertical gauge is hidden. */
export function DepthPill({ depth }: { depth: MotionValue<number> }) {
  const { text, zone } = useDepthText(depth);
  return (
    <div className="depth-pill" aria-hidden="true">
      <Submarine small /> {text} <span className="depth-pill-zone">· {zone}</span>
    </div>
  );
}

/** A little yellow submarine (or another player's colour) facing right. */
export function Submarine({ hue, small = false }: { hue?: number; small?: boolean }) {
  const w = small ? 26 : 46;
  const body = hue === undefined ? "#ffd166" : `hsl(${hue} 75% 62%)`;
  const dark = hue === undefined ? "#c98a1b" : `hsl(${hue} 60% 38%)`;
  return (
    <svg className="sub-svg" width={w} height={w * 0.62} viewBox="0 0 64 40" aria-hidden="true">
      {/* propeller */}
      <g className="sub-prop">
        <ellipse cx="5" cy="22" rx="2.2" ry="7" fill={dark} />
      </g>
      <rect x="6" y="20.5" width="6" height="3" fill={dark} />
      {/* tail fins */}
      <path d="M10 22 L4 13 L14 17 Z M10 22 L4 31 L14 27 Z" fill={dark} />
      {/* hull */}
      <path d="M12 22 C 12 13, 22 11, 36 11 C 52 11, 60 16, 60 22 C 60 28, 52 33, 36 33 C 22 33, 12 31, 12 22 Z" fill={body} stroke={dark} strokeWidth="1.5" />
      {/* tower + periscope */}
      <path d="M28 11 L30 4 L42 4 L44 11 Z" fill={body} stroke={dark} strokeWidth="1.5" />
      <path d="M38 4 L38 0.5 L44 0.5" fill="none" stroke={dark} strokeWidth="1.8" strokeLinecap="round" />
      {/* portholes */}
      <circle cx="26" cy="22" r="3.6" fill="#bdefff" stroke={dark} strokeWidth="1.4" />
      <circle cx="37" cy="22" r="3.6" fill="#bdefff" stroke={dark} strokeWidth="1.4" />
      <circle cx="48" cy="22" r="3.6" fill="#bdefff" stroke={dark} strokeWidth="1.4" />
      <circle cx="25" cy="21" r="1.1" fill="#fff" />
      <circle cx="36" cy="21" r="1.1" fill="#fff" />
      <circle cx="47" cy="21" r="1.1" fill="#fff" />
      {/* hull stripe */}
      <path d="M16 28 C 26 30.5, 46 30.5, 57 27" fill="none" stroke={dark} strokeWidth="1.2" opacity="0.6" />
    </svg>
  );
}
