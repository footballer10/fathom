import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import type { MotionValue } from "framer-motion";
import { useState } from "react";
import { ZONES, formatDepth, zoneForDepth } from "@fathom/shared";

/** Bottom of the gauge: a perfect game (700 points). */
export const GAUGE_MAX_DEPTH = 7000;

function useDepthText(depth: MotionValue<number>) {
  const [text, setText] = useState(() => formatDepth(depth.get()));
  const [zone, setZone] = useState(() => zoneForDepth(depth.get()).name);
  useMotionValueEvent(depth, "change", (d) => {
    setText(formatDepth(d));
    setZone(zoneForDepth(d).name);
  });
  return { text, zone };
}

/** Vertical gauge with the diver on it (wide screens). */
export function DepthGauge({ depth }: { depth: MotionValue<number> }) {
  const top = useTransform(depth, (d) => `${Math.min(100, (d / GAUGE_MAX_DEPTH) * 100)}%`);
  const { text, zone } = useDepthText(depth);

  return (
    <aside className="gauge" aria-label={`Depth ${text}, ${zone}`}>
      <div className="gauge-track">
        {ZONES.map((z) => (
          <div key={z.name} className="gauge-mark" style={{ top: `${(z.minDepth / GAUGE_MAX_DEPTH) * 100}%` }}>
            <span className="gauge-mark-label">{z.name.replace(" Zone", "")}</span>
            <span className="gauge-mark-depth">{z.minDepth.toLocaleString("en-US")} m</span>
          </div>
        ))}
        <motion.div className="gauge-fill" style={{ height: top }} />
        <motion.div className="gauge-diver" style={{ top }}>
          <Diver />
          <span className="gauge-readout">{text}</span>
        </motion.div>
      </div>
    </aside>
  );
}

/** Compact depth readout for phones, where the vertical gauge is hidden. */
export function DepthPill({ depth }: { depth: MotionValue<number> }) {
  const { text, zone } = useDepthText(depth);
  return (
    <div className="depth-pill" aria-hidden="true">
      <Diver small /> {text} <span className="depth-pill-zone">· {zone}</span>
    </div>
  );
}

function Diver({ small = false }: { small?: boolean }) {
  const s = small ? 18 : 34;
  return (
    <svg className="diver" width={s} height={s} viewBox="0 0 40 40" aria-hidden="true">
      {/* air tank */}
      <rect x="8" y="12" width="7" height="16" rx="3" fill="#f4a261" />
      {/* body */}
      <path d="M13 14 C 18 10, 28 12, 30 20 C 30 27, 22 30, 15 28 Z" fill="#1d3557" />
      {/* helmet */}
      <circle cx="27" cy="13" r="7" fill="#e9c46a" stroke="#b08a2e" strokeWidth="1.5" />
      <circle cx="28.5" cy="12.5" r="3.6" fill="#8ecae6" stroke="#1d3557" strokeWidth="1" />
      {/* flippers */}
      <path d="M14 27 L 6 36 L 12 35 Z M18 28 L 14 38 L 20 35 Z" fill="#2a9d8f" />
      {/* bubbles */}
      <circle cx="34" cy="5" r="1.8" fill="none" stroke="#e0f7ff" strokeWidth="1" />
      <circle cx="37" cy="1.5" r="1.2" fill="none" stroke="#e0f7ff" strokeWidth="0.8" />
    </svg>
  );
}
