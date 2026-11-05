import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import type { MotionValue } from "framer-motion";
import { useState } from "react";
import { ZONES, formatDepth, zoneForDepth } from "@fathom/shared";
import type { Look } from "@fathom/shared";
import { useMyLook } from "../rewards";
import { SubArt, SubRig } from "./Cosmetics";

/** Bottom of the gauge: a perfect game (700 points). */
export const GAUGE_MAX_DEPTH = 7000;

/** Another diver in a party Dive, shown as their own submarine on the gauge. */
export interface GaugeDiver {
  id: string;
  name: string;
  depth: number;
  hue: number;
  /** Their shop look (sub, trail, sidekick). */
  look?: Look;
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
          <SubRig look={o.look ?? {}} />
          <span className="gauge-sub-name">{o.name}</span>
        </div>
      ))}
      <motion.div className="gauge-sub gauge-sub--you" style={{ top }}>
        <SubRig />
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

/** A submarine in your shop paint job (or another player's look, or a party colour). */
export function Submarine({ hue, small = false, look }: { hue?: number; small?: boolean; look?: Look }) {
  const mine = useMyLook();
  const skin = look ? look.skin : hue === undefined ? mine.skin : undefined;
  return <SubArt skin={skin} hue={hue} width={small ? 26 : 46} />;
}
