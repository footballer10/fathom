import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BATTLE_DEFAULTS, tierInfo, type RoomSnapshot } from "@fathom/shared";
import { serverNow } from "../api";
import type { RoomEvent } from "./useRoom";
import { ArenaScenery } from "./ArenaScenery";
import { RoomName } from "./RoomName";

type Pos = { x: number; y: number };
type Seat = Pos & { id: string; nickname: string; hue: number };
type Flash =
  | { id: number; kind: "pop"; x: number; y: number }
  | { id: number; kind: "answer"; x: number; y: number; text: string; color: string; emoji: string }
  | { id: number; kind: "life"; x: number; y: number; text: string; who: string; count: number };

/** The middle of the ring, where the pufferfish sits. */
const CENTER: Pos = { x: 50, y: 52 };
/** Your spot on the ring: bottom centre, just above your dock. */
const YOU_SEAT: Pos = { x: 50, y: 74 };
/** Size of the seating ring, in % of the tank. */
const RING = { rx: 38, ry: 24 };

/**
 * Battle's "pass the pufferfish" arena. Everyone sits evenly around a ring with
 * the pufferfish in the middle; you're at the bottom, with your answer box in the
 * dock below. The fish turns to face whoever's turn it is and puffs up as their
 * time runs out. A correct answer sends it on; running out of time pops it. All
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
  const holderAt: Pos | undefined = heading ? (headingToMe ? YOU_SEAT : seats.get(heading)) : undefined;
  // The fish is drawn facing left. Point its face at whoever holds it, flipping
  // rather than turning upside down when they're on the right.
  const aim = holderAt ? (Math.atan2(holderAt.y - CENTER.y, holderAt.x - CENTER.x) * 180) / Math.PI : 180;
  const facingRight = Math.abs(aim) < 90;
  const tilt = facingRight ? aim : aim > 0 ? aim - 180 : aim + 180;

  // The fish swims most of the way over to whoever has it, then back out on
  // the next pass, curving through the middle of the ring rather than cutting across.
  const fishAt: Pos = holderAt ? toward(holderAt, 0.5) : CENTER;
  const target = `${fishAt.x},${fishAt.y}`;
  const track = useRef({ target, from: fishAt, to: fishAt });
  if (track.current.target !== target) track.current = { target, from: track.current.to, to: fishAt };
  const { from, to } = track.current;
  const mid = { x: (from.x + to.x) / 2 + (CENTER.x - (from.x + to.x) / 2) * 0.6, y: (from.y + to.y) / 2 + (CENTER.y - (from.y + to.y) / 2) * 0.6 };
  const moved = from.x !== to.x || from.y !== to.y;
  const swim = reducedMotion || !moved ? { duration: 0 } : { duration: 0.85, times: [0, 0.5, 1], ease: "easeInOut" as const };

  const arenaRef = useRef<HTMLDivElement>(null);
  // The tank fills the screen; bring all of it into view when the game starts.
  useEffect(() => {
    arenaRef.current?.scrollIntoView({ block: "end", behavior: reducedMotion ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      const seat: Pos | undefined = isMe ? YOU_SEAT : seats.get(e.playerId);
      if (!seat) continue;
      const fish = isMe ? toward(YOU_SEAT, 0.5) : toward(seat, 0.5);
      if (e.type === "lifeLost") add.push({ id: e.id, kind: "pop", ...fish });
      if (e.type === "turnResult") {
        const t = tierInfo(e.tier);
        add.push({ id: e.id, kind: "answer", ...toward(seat, 0.55), text: e.canonical, color: t.color, emoji: t.emoji });
        if (e.livesGained > 0) {
          const who = isMe ? "You" : seats.get(e.playerId)?.nickname ?? "Someone";
          add.push({ id: e.id + 0.5, kind: "life", x: seat.x, y: seat.y - 10, text: `+${e.livesGained} ❤️`, who, count: e.livesGained });
        }
      }
    }
    if (!add.length) return;
    setFlashes((f) => [...f, ...add]);
    const ids = new Set(add.map((a) => a.id));
    setTimeout(() => setFlashes((f) => f.filter((x) => !ids.has(x.id))), 2800);
  }, [events, seats, state.you]);

  const bubbles = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({ id: i, left: 4 + Math.random() * 92, size: 4 + Math.random() * 9, dur: 7 + Math.random() * 8, delay: -Math.random() * 15 })),
    [],
  );

  const headingName = heading ? (headingToMe ? "you" : seats.get(heading)?.nickname ?? "someone") : "";
  const activeName = !b.turnPlayerId ? null : myTurn ? "You have" : `${headingName} has`;

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
      <ArenaScenery />

      <div className="arena-top">
        <div className="arena-prompt-card">
        <div className="arena-meta">
          {variantLabel(state)}
          {b.category.replace("-", " & ")} · prompt {b.round} · base {b.baseSeconds}s
        </div>
        <h2 className="arena-prompt">{b.prompt}</h2>
        </div>
        <div className="arena-status">
          <span>{activeName ? `${activeName} the pufferfish!` : heading ? `Passing to ${headingName}…` : "Next turn…"}</span>
          <span ref={secsRef} className="arena-secs" />
        </div>
        {b.teamLives && (
          <div className="relay-bar">
            {([0, 1] as const).map((t) => {
              const active = state.players.find((p) => p.id === (b.turnPlayerId ?? b.nextTurnPlayerId))?.team === t;
              const letter = b.teamLetters?.[t] ?? null;
              return (
                <span key={t} className={`relay-team relay-team--${t}${active ? " relay-team--up" : ""}`} title={`${t === 0 ? "Coral" : "Kelp"}'s next answer starts with this letter`}>
                  <span className="relay-team-name">{t === 0 ? "🪸 Coral" : "🌿 Kelp"}</span>
                  <span className="relay-team-lives">❤️ {b.teamLives![t]}</span>
                  <span className="relay-team-letter">{letter ? letter.toUpperCase() : "any"}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {[...seats.values()].map((s) => {
        const p = state.players.find((x) => x.id === s.id)!;
        const isActive = s.id === b.turnPlayerId;
        const live = isActive && typing?.playerId === s.id ? typing.text : "";
        return (
          <div
            key={s.id}
            className={`seat${isActive ? " seat--active" : ""}${p.eliminated ? " seat--out" : ""}${p.connected ? "" : " seat--away"}${p.team !== undefined ? ` seat--team-${p.team}` : ""}`}
            style={{ left: `${s.x}%`, top: `${s.y}%`, "--seat-hue": s.hue } as React.CSSProperties}
          >
            <div className="seat-avatar">
              {isActive && <span className="seat-ring" aria-hidden />}
              {p.eliminated ? "💀" : p.nickname.slice(0, 1).toUpperCase()}
              <Lives lives={p.lives} meter={p.lifeMeter} out={p.eliminated} />
            </div>
            <div className="seat-name">
              {state.hostId === p.id && "👑 "}
              <RoomName id={p.id} name={p.nickname} />
            </div>
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

      <svg className="arena-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <ellipse cx={CENTER.x} cy={CENTER.y} rx={RING.rx} ry={RING.ry} />
        {holderAt && <line className={`arena-aim${b.turnPlayerId ? "" : " arena-aim--next"}`} x1={fishAt.x} y1={fishAt.y} x2={holderAt.x} y2={holderAt.y} />}
      </svg>
      <div className="arena-stage" style={{ left: `${CENTER.x}%`, top: `${CENTER.y}%` }} aria-hidden />

      <motion.div
        className="puffer-pos"
        initial={false}
        animate={{ left: [from.x, mid.x, to.x].map((v) => `${v}%`), top: [from.y, mid.y, to.y].map((v) => `${v}%`) }}
        transition={swim}
      >
        <motion.div
          className="puffer-turn"
          initial={false}
          animate={{ scaleX: facingRight ? -1 : 1, rotate: facingRight ? -tilt : tilt }}
          transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 170, damping: 15 }}
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
            <LifeEarned key={f.id} flash={f} reducedMotion={reducedMotion} />
          ),
        )}
      </AnimatePresence>

      {!me.spectator && (
        <div
          className={`seat seat--you${myTurn ? " seat--active" : ""}${me.eliminated ? " seat--out" : ""}${me.team !== undefined ? ` seat--team-${me.team}` : ""}`}
          style={{ left: `${YOU_SEAT.x}%`, top: `${YOU_SEAT.y}%`, "--seat-hue": hashHue(me.id) } as React.CSSProperties}
        >
          <div className="seat-avatar">
            {myTurn && <span className="seat-ring" aria-hidden />}
            {me.eliminated ? "💀" : me.nickname.slice(0, 1).toUpperCase()}
            <Lives lives={me.lives} meter={me.lifeMeter} out={me.eliminated} />
          </div>
          <div className="seat-name">You</div>
        </div>
      )}

      <div className={`arena-dock${myTurn ? " arena-dock--active" : ""}${me.eliminated ? " arena-dock--out" : ""}`}>
        <div className="dock-input">{input}</div>
      </div>
    </div>
  );
}

/**
 * Lives as a heart and count inside a ring that fills as good answers come in.
 * A full ring turns into one more life (no cap).
 */
function Lives({ lives, meter, out }: { lives: number; meter: number; out: boolean }) {
  if (out) return <div className="seat-lives">out</div>;
  const n = Math.max(0, lives);
  const frac = Math.min(1, Math.max(0, (meter ?? 0) / BATTLE_DEFAULTS.lifeMeterFull));
  return (
    <div className="seat-lives life-ring" title={`${n} ${n === 1 ? "life" : "lives"} · ${Math.round(frac * 100)}% to the next`}>
      <svg viewBox="0 0 36 36" aria-hidden>
        <circle className="life-ring-track" cx="18" cy="18" r="16" />
        <circle className="life-ring-fill" cx="18" cy="18" r="16" pathLength={100} strokeDasharray={`${frac * 100} 100`} />
      </svg>
      <span className="life-ring-count">❤️{n}</span>
    </div>
  );
}

/**
 * Someone filled their life circle: a banner everyone sees, and a big heart
 * that flies from it into their seat. It never blocks the game.
 */
function LifeEarned({ flash, reducedMotion }: { flash: Extract<Flash, { kind: "life" }>; reducedMotion: boolean }) {
  const lives = flash.count === 1 ? "an extra life" : `${flash.count} extra lives`;
  return (
    <>
      <motion.div
        className="life-banner"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 10 }}
        animate={{ opacity: [0, 1, 1, 0], scale: reducedMotion ? 1 : [0.6, 1.08, 1, 1], y: 0 }}
        transition={{ duration: 2.6, times: [0, 0.12, 0.8, 1] }}
      >
        <span className="life-banner-heart">❤️</span> {flash.who === "You" ? `You earned ${lives}!` : `${flash.who} earned ${lives}!`}
      </motion.div>
      <motion.div
        className="life-heart"
        initial={{ left: "50%", top: "36%", scale: 0.4, opacity: 0 }}
        animate={
          reducedMotion
            ? { left: `${flash.x}%`, top: `${flash.y}%`, scale: 1, opacity: [0, 1, 0] }
            : { left: ["50%", "50%", `${flash.x}%`], top: ["36%", "34%", `${flash.y}%`], scale: [0.4, 1.6, 0.7], opacity: [0, 1, 1, 0] }
        }
        transition={{ duration: 1.9, times: reducedMotion ? undefined : [0, 0.35, 1], ease: "easeInOut" }}
      >
        ❤️
      </motion.div>
      <motion.div
        className="arena-life"
        style={{ left: `${flash.x}%`, top: `${flash.y}%` }}
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: reducedMotion ? 1 : [0.3, 1.5, 1], opacity: [0, 1, 1, 0], y: reducedMotion ? 0 : -34 }}
        transition={{ delay: reducedMotion ? 0 : 1.6, duration: 1.1, times: [0, 0.3, 0.75, 1] }}
      >
        {flash.text}
      </motion.div>
    </>
  );
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

function variantLabel(state: RoomSnapshot) {
  const v = (state.settings as { variant?: string }).variant;
  return v === "hotpotato" ? "🥔 Hot Potato · " : v === "relay" ? "🔤 Relay · " : "";
}

/** A point part of the way from the centre of the tank toward a seat. */
function toward(p: Pos, t: number): Pos {
  return { x: CENTER.x + (p.x - CENTER.x) * t, y: CENTER.y + (p.y - CENTER.y) * t };
}

/** Everyone but you, spaced evenly around the ring clockwise after you (you're at the bottom). */
function seatPositions(state: RoomSnapshot) {
  const players = state.players.filter((p) => !p.spectator);
  const youAt = players.findIndex((p) => p.id === state.you);
  const others = youAt < 0 ? players : [...players.slice(youAt + 1), ...players.slice(0, youAt)];
  const map = new Map<string, Seat>();
  const slots = others.length + (youAt < 0 ? 0 : 1);
  others.forEach((p, i) => {
    // Slot 0 (straight down) is yours; the rest go clockwise from there.
    const step = youAt < 0 ? i + 0.5 : i + 1;
    const a = Math.PI / 2 + (2 * Math.PI * step) / slots;
    map.set(p.id, { id: p.id, nickname: p.nickname, x: CENTER.x + RING.rx * Math.cos(a), y: CENTER.y + RING.ry * Math.sin(a), hue: hashHue(p.id) });
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
