import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { tierInfo, type RoomSnapshot } from "@fathom/shared";
import { serverNow } from "../api";
import type { RoomEvent } from "./useRoom";

type Pos = { x: number; y: number };
type Seat = Pos & { id: string; nickname: string; hue: number };
type Flash =
  | { id: number; kind: "pop"; x: number; y: number }
  | { id: number; kind: "answer"; x: number; y: number; text: string; color: string; emoji: string }
  | { id: number; kind: "life"; x: number; y: number; text: string };

/** Where the fish waits when it's your turn: just above your dock. */
const YOU_FISH: Pos = { x: 50, y: 66 };
const CENTER: Pos = { x: 50, y: 46 };

/**
 * Battle's "pass the pufferfish" arena. Everyone else sits around the top of
 * the tank; you're docked at the bottom with your answer box right beside you.
 * The pufferfish arcs over to whoever's turn it is and puffs up as their time
 * runs out. A correct answer sends it on; running out of time pops it. All
 * drawn here as SVG and CSS.
 */
export function PufferArena({
  state,
  typing,
  events,
  reducedMotion,
  input,
}: {
  state: RoomSnapshot;
  typing: { playerId: string; text: string } | null;
  events: RoomEvent[];
  reducedMotion: boolean;
  /** Your answer box, shown in the dock next to your avatar. */
  input: ReactNode;
}) {
  const b = state.battle!;
  const me = state.players.find((p) => p.id === state.you)!;
  const seats = useMemo(() => seatPositions(state), [state]);
  const myTurn = b.turnPlayerId === state.you;
  // Between turns the fish is already on its way to whoever goes next.
  const heading = b.turnPlayerId ?? b.nextTurnPlayerId ?? null;
  const headingToMe = heading === state.you;
  const holder = heading ? (headingToMe ? { ...YOU_FISH, id: state.you } : seats.get(heading)) : undefined;
  const fishAt: Pos = !holder ? CENTER : headingToMe ? YOU_FISH : toward(holder, 0.5);
  const holderAt: Pos | undefined = holder ? (headingToMe ? { x: 50, y: 100 } : holder) : undefined;
  // The fish is drawn facing left; turn it to face whoever holds it.
  const facingRight = !!holderAt && holderAt.x > fishAt.x + 2;
  const tilt = holderAt ? Math.max(-25, Math.min(25, ((holderAt.y - fishAt.y) / 2) * (facingRight ? 1 : -1))) : 0;

  // Arc from the previous spot to the new one, rather than sliding in a straight line.
  const target = `${fishAt.x},${fishAt.y}`;
  const track = useRef({ target, from: fishAt, to: fishAt });
  if (track.current.target !== target) track.current = { target, from: track.current.to, to: fishAt };
  const { from, to } = track.current;
  const mid = { x: (from.x + to.x) / 2 + (CENTER.x - (from.x + to.x) / 2) * 0.35, y: Math.min(from.y, to.y) - 10 };
  const path = { x: [from.x, mid.x, to.x], y: [from.y, mid.y, to.y], moved: from.x !== to.x || from.y !== to.y };

  const arenaRef = useRef<HTMLDivElement>(null);
  const puffRef = useRef<HTMLDivElement>(null);
  const secsRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const total = Math.max(1, b.turnEndsAt - b.turnStartedAt);
    const tick = () => {
      const left = Math.max(0, b.turnEndsAt - serverNow());
      const frac = b.turnPlayerId ? Math.min(1, left / total) : 0;
      arenaRef.current?.style.setProperty("--turn-left", frac.toFixed(3));
      const el = puffRef.current;
      if (el) {
        el.style.setProperty("--inflate", (b.turnPlayerId ? 1 - frac : 0).toFixed(3));
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

  // Pops, accepted answers and extra lives float up from the seats.
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const lastSeen = useRef(events.length ? events[events.length - 1].id : 0);
  useEffect(() => {
    const fresh = events.filter((e) => e.id > lastSeen.current);
    if (!fresh.length) return;
    lastSeen.current = fresh[fresh.length - 1].id;
    const add: Flash[] = [];
    for (const e of fresh) {
      if (!("playerId" in e) || typeof e.playerId !== "string") continue;
      const isMe = e.playerId === state.you;
      const seat: Pos | undefined = isMe ? { x: 50, y: 84 } : seats.get(e.playerId);
      if (!seat) continue;
      const fish = isMe ? YOU_FISH : toward(seat, 0.5);
      if (e.type === "lifeLost") add.push({ id: e.id, kind: "pop", ...fish });
      if (e.type === "turnResult") {
        const t = tierInfo(e.tier);
        add.push({ id: e.id, kind: "answer", ...(isMe ? { x: 50, y: 74 } : toward(seat, 0.22)), text: e.canonical, color: t.color, emoji: t.emoji });
        if (e.livesGained > 0) add.push({ id: e.id + 0.5, kind: "life", x: seat.x + (isMe ? 18 : 0), y: seat.y - (isMe ? 6 : 10), text: `+${e.livesGained} ❤️` });
      }
    }
    if (!add.length) return;
    setFlashes((f) => [...f, ...add]);
    const ids = new Set(add.map((a) => a.id));
    setTimeout(() => setFlashes((f) => f.filter((x) => !ids.has(x.id))), 2000);
  }, [events, seats, state.you]);

  const bubbles = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({ id: i, left: 4 + Math.random() * 92, size: 4 + Math.random() * 9, dur: 7 + Math.random() * 8, delay: -Math.random() * 15 })),
    [],
  );

  const headingName = heading ? (headingToMe ? "you" : seats.get(heading)?.nickname ?? "someone") : "";
  const activeName = !b.turnPlayerId ? null : myTurn ? "You have" : `${headingName} has`;
  const arc = reducedMotion || !path.moved ? { duration: 0 } : { duration: 0.75, times: [0, 0.45, 1], ease: "easeInOut" as const };

  return (
    <div
      ref={arenaRef}
      className={`arena${myTurn ? " arena--mine" : ""}${reducedMotion ? " arena--still" : ""}`}
      role="img"
      aria-label={activeName ? `${activeName} the pufferfish` : "Waiting for the next turn"}
    >
      <div className="arena-rays" aria-hidden />
      <div className="arena-bubbles" aria-hidden>
        {bubbles.map((x) => (
          <span key={x.id} style={{ left: `${x.left}%`, width: x.size, height: x.size, animationDuration: `${x.dur}s`, animationDelay: `${x.delay}s` }} />
        ))}
      </div>
      <div className="arena-floor" aria-hidden />

      <div className="arena-status">
        <span>{activeName ? `${activeName} the pufferfish!` : heading ? `Passing to ${headingName}…` : "Next turn…"}</span>
        <span ref={secsRef} className="arena-secs" />
      </div>

      {[...seats.values()].map((s) => {
        const p = state.players.find((x) => x.id === s.id)!;
        const isActive = s.id === b.turnPlayerId;
        const live = isActive && typing?.playerId === s.id ? typing.text : "";
        return (
          <div
            key={s.id}
            className={`seat${isActive ? " seat--active" : ""}${p.eliminated ? " seat--out" : ""}${p.connected ? "" : " seat--away"}`}
            style={{ left: `${s.x}%`, top: `${s.y}%`, "--seat-hue": s.hue } as React.CSSProperties}
          >
            <div className="seat-avatar">
              {isActive && <span className="seat-ring" aria-hidden />}
              {p.eliminated ? "💀" : p.nickname.slice(0, 1).toUpperCase()}
            </div>
            <div className="seat-name">
              {state.hostId === p.id && "👑 "}
              {p.nickname}
            </div>
            <Lives lives={p.lives} out={p.eliminated} />
            <AnimatePresence>
              {isActive && (
                <motion.div
                  className={`seat-bubble${live ? "" : " seat-bubble--thinking"}`}
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.7, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 400, damping: 24 }}
                >
                  {live ? (
                    <>
                      {live}
                      <span className="caret" />
                    </>
                  ) : (
                    <span className="dots">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      <motion.div className="puffer-pos" initial={false} animate={{ left: path.x.map((v) => `${v}%`), top: path.y.map((v) => `${v}%`) }} transition={arc}>
        <motion.div
          className="puffer-turn"
          initial={false}
          animate={{ scaleX: facingRight ? -1 : 1, rotate: tilt }}
          transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 16 }}
        >
          <div className="puffer-bob">
            <div ref={puffRef} className="puffer">
              <Pufferfish />
            </div>
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {flashes.map((f) =>
          f.kind === "pop" ? (
            <Pop key={f.id} x={f.x} y={f.y} reducedMotion={reducedMotion} />
          ) : f.kind === "answer" ? (
            <motion.div
              key={f.id}
              className="arena-answer"
              style={{ left: `${f.x}%`, top: `${f.y}%`, "--tier": f.color } as React.CSSProperties}
              initial={{ y: 10, opacity: 0, scale: 0.6 }}
              animate={{ y: reducedMotion ? 0 : -36, opacity: [0, 1, 1, 0], scale: 1 }}
              transition={{ duration: 1.8, times: [0, 0.15, 0.75, 1] }}
            >
              {f.emoji} {f.text}
            </motion.div>
          ) : (
            <motion.div
              key={f.id}
              className="arena-life"
              style={{ left: `${f.x}%`, top: `${f.y}%` }}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: reducedMotion ? 1 : [0.3, 1.4, 1], opacity: [0, 1, 1, 0], y: reducedMotion ? 0 : -30 }}
              transition={{ duration: 1.8, times: [0, 0.2, 0.8, 1] }}
            >
              {f.text}
            </motion.div>
          ),
        )}
      </AnimatePresence>

      <div className={`arena-dock${myTurn ? " arena-dock--active" : ""}${me.eliminated ? " arena-dock--out" : ""}`}>
        <div className="dock-me" style={{ "--seat-hue": hashHue(me.id) } as React.CSSProperties}>
          <div className="seat-avatar">
            {myTurn && <span className="seat-ring" aria-hidden />}
            {me.eliminated ? "💀" : me.nickname.slice(0, 1).toUpperCase()}
          </div>
          {!me.spectator && <Lives lives={me.lives} out={me.eliminated} />}
        </div>
        <div className="dock-input">{input}</div>
      </div>
    </div>
  );
}

/** Hearts for up to 5 lives; past that, a count (bonus lives have no cap). */
function Lives({ lives, out }: { lives: number; out: boolean }) {
  if (out) return <div className="seat-lives">out</div>;
  const n = Math.max(0, lives);
  return <div className="seat-lives">{n <= 5 ? "❤️".repeat(n) : `❤️×${n}`}</div>;
}

/** Time ran out: a flash, a ring and the spikes flying off. */
function Pop({ x, y, reducedMotion }: { x: number; y: number; reducedMotion: boolean }) {
  const spikes = useMemo(() => Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2 + Math.random() * 0.3), []);
  return (
    <motion.div className="arena-pop" style={{ left: `${x}%`, top: `${y}%` }} initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {!reducedMotion && (
        <>
          <motion.span className="pop-ring" initial={{ scale: 0.2, opacity: 0.9 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 0.7, ease: "easeOut" }} />
          {spikes.map((a, i) => (
            <motion.span
              key={i}
              className="pop-spike"
              style={{ rotate: `${(a * 180) / Math.PI + 90}deg` }}
              initial={{ x: 0, y: 0, opacity: 1 }}
              animate={{ x: Math.cos(a) * 90, y: Math.sin(a) * 90, opacity: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          ))}
        </>
      )}
      <motion.span
        className="pop-word"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: reducedMotion ? 1 : [0.3, 1.5, 1.2], opacity: [0, 1, 0] }}
        transition={{ duration: 1.2, times: [0, 0.25, 1] }}
      >
        POP!
      </motion.span>
    </motion.div>
  );
}

/** A point part of the way from the centre of the tank toward a seat. */
function toward(p: Pos, t: number): Pos {
  return { x: CENTER.x + (p.x - CENTER.x) * t, y: CENTER.y + (p.y - CENTER.y) * t };
}

/** Everyone but you, spread along the top arc of the tank, clockwise after you. */
function seatPositions(state: RoomSnapshot) {
  const players = state.players.filter((p) => !p.spectator);
  const youAt = players.findIndex((p) => p.id === state.you);
  const others = youAt < 0 ? players : [...players.slice(youAt + 1), ...players.slice(0, youAt)];
  const map = new Map<string, Seat>();
  const n = others.length;
  others.forEach((p, i) => {
    // From the left side (200°) over the top to the right side (340°).
    const deg = n === 1 ? 270 : 200 + (140 * i) / (n - 1);
    const a = (deg * Math.PI) / 180;
    map.set(p.id, { id: p.id, nickname: p.nickname, x: 50 + 39 * Math.cos(a), y: 54 + 38 * Math.sin(a), hue: hashHue(p.id) });
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
  const spikes = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);
  return (
    <svg viewBox="-60 -60 120 120" className="puffer-svg" aria-hidden>
      <g className="puffer-tail">
        <path d="M28 0 L52 -16 Q45 0 52 16 Z" />
      </g>
      <g className="puffer-spikes">
        {spikes.map((a, i) => (
          <path key={i} d={`M${Math.cos(a - 0.12) * 27} ${Math.sin(a - 0.12) * 27} L${Math.cos(a) * 41} ${Math.sin(a) * 41} L${Math.cos(a + 0.12) * 27} ${Math.sin(a + 0.12) * 27} Z`} />
        ))}
      </g>
      <circle className="puffer-body" r="30" />
      <ellipse className="puffer-belly" cx="-2" cy="12" rx="21" ry="14" />
      <circle className="puffer-spot" cx="6" cy="-14" r="3" />
      <circle className="puffer-spot" cx="16" cy="-4" r="2.4" />
      <circle className="puffer-spot" cx="-2" cy="-22" r="2" />
      <circle className="puffer-spot" cx="14" cy="-18" r="1.6" />
      <path className="puffer-fin" d="M4 4 Q14 -2 18 8 Q10 10 4 4 Z" />
      <circle cx="-14" cy="-6" r="8.5" fill="#fff" />
      <circle className="puffer-pupil" cx="-16" cy="-6" r="4.2" />
      <circle cx="-17.6" cy="-7.8" r="1.5" fill="#fff" />
      <path className="puffer-brow" d="M-22 -16 Q-14 -19 -7 -15" />
      <ellipse className="puffer-mouth" cx="-29" cy="5" rx="3.2" ry="2.6" />
      <circle className="puffer-cheek" cx="-20" cy="8" r="3.5" />
    </svg>
  );
}
