import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { RoomSnapshot } from "@fathom/shared";
import { serverNow } from "../api";
import type { RoomEvent } from "./useRoom";

/**
 * Battle's "pass the pufferfish" arena. Players sit around the edge of a tank;
 * the pufferfish swims to whoever's turn it is and puffs up as their time runs
 * out. A correct answer sends it on to the next player; running out of time
 * pops it. All drawn here as SVG and CSS.
 */
export function PufferArena({
  state,
  typing,
  events,
  reducedMotion,
}: {
  state: RoomSnapshot;
  typing: { playerId: string; text: string } | null;
  events: RoomEvent[];
  reducedMotion: boolean;
}) {
  const b = state.battle!;
  const seats = useMemo(() => seatPositions(state), [state]);
  const active = b.turnPlayerId ? seats.get(b.turnPlayerId) : undefined;
  // Hover between the centre and the active player's seat.
  const fishAt = active ? { x: 50 + (active.x - 50) * 0.42, y: 55 + (active.y - 55) * 0.42 } : { x: 50, y: 55 };
  // The fish is drawn facing left; flip it so it faces whoever holds it.
  const flip = !!active && active.x > fishAt.x + 1;

  const puffRef = useRef<HTMLDivElement>(null);
  const secsRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const total = Math.max(1, b.turnEndsAt - b.turnStartedAt);
    const tick = () => {
      const left = Math.max(0, b.turnEndsAt - serverNow());
      const inflate = b.turnPlayerId ? 1 - Math.min(1, left / total) : 0;
      const el = puffRef.current;
      if (el) {
        el.style.setProperty("--inflate", inflate.toFixed(3));
        el.classList.toggle("puffer--low", !reducedMotion && !!b.turnPlayerId && left <= 3000 && left > 0);
      }
      if (secsRef.current) {
        secsRef.current.textContent = b.turnPlayerId ? `${Math.ceil(left / 1000)}s` : "";
        secsRef.current.classList.toggle("arena-secs--low", !!b.turnPlayerId && left <= 3000);
      }
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [b.turnStartedAt, b.turnEndsAt, b.turnPlayerId, reducedMotion]);

  // Pops (time ran out) and accepted answers float up from the seats.
  const [flashes, setFlashes] = useState<{ id: number; kind: "pop" | "answer"; text: string; x: number; y: number }[]>([]);
  const lastSeen = useRef(events.length ? events[events.length - 1].id : 0);
  useEffect(() => {
    const fresh = events.filter((e) => e.id > lastSeen.current);
    if (!fresh.length) return;
    lastSeen.current = fresh[fresh.length - 1].id;
    const add: typeof flashes = [];
    for (const e of fresh) {
      const seat = "playerId" in e && typeof e.playerId === "string" ? seats.get(e.playerId) : undefined;
      if (!seat) continue;
      if (e.type === "lifeLost") add.push({ id: e.id, kind: "pop", text: "POP!", x: 50 + (seat.x - 50) * 0.42, y: 55 + (seat.y - 55) * 0.42 });
      if (e.type === "turnResult" && "canonical" in e && e.canonical) add.push({ id: e.id, kind: "answer", text: String(e.canonical), x: seat.x, y: seat.y });
    }
    if (!add.length) return;
    setFlashes((f) => [...f, ...add]);
    const ids = new Set(add.map((a) => a.id));
    setTimeout(() => setFlashes((f) => f.filter((x) => !ids.has(x.id))), 1600);
  }, [events, seats]);

  const spring = reducedMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 70, damping: 14 };

  return (
    <div className="arena" role="img" aria-label={active ? `The pufferfish is with ${active.nickname}` : "Waiting for the next turn"}>
      <div className="arena-water" aria-hidden />
      <div className="arena-status">
        <span>{active ? (active.id === state.you ? "You have the pufferfish!" : `${active.nickname} has the pufferfish`) : "Next turn…"}</span>
        <span ref={secsRef} className="arena-secs" />
      </div>
      {[...seats.values()].map((s) => {
        const p = state.players.find((x) => x.id === s.id)!;
        const isActive = s.id === b.turnPlayerId;
        const live = isActive && typing?.playerId === s.id && typing.text && s.id !== state.you ? typing.text : "";
        return (
          <div
            key={s.id}
            className={`seat${isActive ? " seat--active" : ""}${p.eliminated ? " seat--out" : ""}${p.id === state.you ? " seat--you" : ""}${p.connected ? "" : " seat--away"}`}
            style={{ left: `${s.x}%`, top: `${s.y}%`, "--seat-hue": s.hue } as React.CSSProperties}
          >
            <AnimatePresence>
              {live && (
                <motion.div className="seat-bubble" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {live}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="seat-avatar">{p.eliminated ? "💀" : p.nickname.slice(0, 1).toUpperCase()}</div>
            <div className="seat-name">
              {state.hostId === p.id && "👑 "}
              {p.nickname}
              {p.id === state.you && <span className="seat-you"> (you)</span>}
            </div>
            {!p.spectator && <div className="seat-lives">{p.eliminated ? "out" : "❤️".repeat(Math.max(0, p.lives))}</div>}
          </div>
        );
      })}

      <motion.div className="puffer-pos" animate={{ left: `${fishAt.x}%`, top: `${fishAt.y}%` }} transition={spring} initial={false}>
        <div ref={puffRef} className={`puffer${flip ? " puffer--flip" : ""}`}>
          <Pufferfish />
        </div>
      </motion.div>

      <AnimatePresence>
        {flashes.map((f) =>
          f.kind === "pop" ? (
            <motion.div
              key={f.id}
              className="arena-pop"
              style={{ left: `${f.x}%`, top: `${f.y}%` }}
              initial={{ scale: 0.3, opacity: 1 }}
              animate={{ scale: reducedMotion ? 1 : 1.8, opacity: 0 }}
              transition={{ duration: 0.9 }}
            >
              POP!
            </motion.div>
          ) : (
            <motion.div
              key={f.id}
              className="arena-answer"
              style={{ left: `${f.x}%`, top: `${f.y}%` }}
              initial={{ y: 0, opacity: 0 }}
              animate={{ y: reducedMotion ? 0 : -50, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.5 }}
            >
              ✓ {f.text}
            </motion.div>
          ),
        )}
      </AnimatePresence>
    </div>
  );
}

/** Seats around an ellipse, you at the bottom, everyone else clockwise from you. */
function seatPositions(state: RoomSnapshot) {
  const players = state.players.filter((p) => !p.spectator);
  const youAt = Math.max(0, players.findIndex((p) => p.id === state.you));
  const ordered = [...players.slice(youAt), ...players.slice(0, youAt)];
  const map = new Map<string, { id: string; nickname: string; x: number; y: number; hue: number }>();
  ordered.forEach((p, i) => {
    const angle = Math.PI / 2 + (2 * Math.PI * i) / ordered.length;
    map.set(p.id, {
      id: p.id,
      nickname: p.nickname,
      x: 50 + 40 * Math.cos(angle),
      y: 55 + 33 * Math.sin(angle),
      hue: hashHue(p.id),
    });
  });
  return map;
}

function hashHue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** The pufferfish. Its size, spikes and colour follow the --inflate CSS variable (0 to 1). */
function Pufferfish() {
  const spikes = Array.from({ length: 14 }, (_, i) => (i / 14) * Math.PI * 2);
  return (
    <svg viewBox="-60 -60 120 120" className="puffer-svg" aria-hidden>
      <g className="puffer-tail">
        <path d="M30 0 L52 -16 Q46 0 52 16 Z" />
      </g>
      <g className="puffer-spikes">
        {spikes.map((a, i) => (
          <line key={i} x1={Math.cos(a) * 26} y1={Math.sin(a) * 26} x2={Math.cos(a) * 40} y2={Math.sin(a) * 40} />
        ))}
      </g>
      <circle className="puffer-body" r="30" />
      <ellipse className="puffer-belly" cx="-2" cy="12" rx="20" ry="13" />
      <circle className="puffer-spot" cx="6" cy="-14" r="3" />
      <circle className="puffer-spot" cx="16" cy="-4" r="2.4" />
      <circle className="puffer-spot" cx="-4" cy="-20" r="2" />
      <path className="puffer-fin" d="M4 4 Q14 -2 18 8 Q10 10 4 4 Z" />
      <circle cx="-14" cy="-6" r="8" fill="#fff" />
      <circle className="puffer-pupil" cx="-16" cy="-6" r="4" />
      <circle cx="-17.5" cy="-7.5" r="1.4" fill="#fff" />
      <ellipse className="puffer-mouth" cx="-29" cy="5" rx="3.2" ry="2.6" />
    </svg>
  );
}
