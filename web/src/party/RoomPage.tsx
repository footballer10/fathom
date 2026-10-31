import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BATTLE_DEFAULTS,
  CATEGORIES,
  DIVE_DEFAULTS,
  MISS_EMOJI,
  VARIANT_INFO,
  formatDepth,
  partyDepth,
  partyDepthScale,
  tierInfo,
} from "@fathom/shared";
import type { BattleSettings, Category, DiveSettings, QuestionRecap, RevealAnswer, RoomSnapshot, TierPoints } from "@fathom/shared";
import type { GaugeDiver } from "../components/DepthGauge";
import { api, serverNow } from "../api";
import { RevealPanel } from "../components/RevealPanel";
import { ShouldCount } from "../components/ShouldCount";
import { DidYouMean } from "../components/DidYouMean";
import { TimerRing } from "../components/TimerRing";
import { NicknamePrompt, getNickname } from "../nickname";
import { navigate } from "../router";
import { useSettings } from "../settings";
import { sounds } from "../sound";
import { Podium } from "./Podium";
import { PufferArena } from "./PufferArena";
import { useRoom } from "./useRoom";
import type { RoomEvent } from "./useRoom";

type Send = ReturnType<typeof useRoom>["send"];

function useNow(intervalMs = 250) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * How many questions the current (or just-finished) game has. Depths use this,
 * never the lobby setting, so changing the setting can't rescale a game already played.
 */
function gameQuestions(state: RoomSnapshot) {
  return state.dive?.total ?? (state.settings as DiveSettings).questionCount;
}

/** A stable colour per player, for their submarine. */
function hueOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Time left in the round, still ticking after you've locked in (or been bitten). */
function RoundClock({ endsAt, totalMs }: { endsAt: number; totalMs: number }) {
  const now = useNow(200);
  const left = Math.max(0, endsAt - now);
  return (
    <div className={`round-clock${left <= 5000 ? " round-clock--low" : ""}`} aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <div className="round-clock-bar">
        <div className="round-clock-fill" style={{ width: `${Math.min(100, (left / totalMs) * 100)}%` }} />
      </div>
      <span>{Math.ceil(left / 1000)}s left</span>
    </div>
  );
}

/** "Shark Tank · ABCD" style room title. */
function variantName(state: RoomSnapshot) {
  const v = (state.settings as { variant?: keyof typeof VARIANT_INFO }).variant ?? "classic";
  return v === "classic" ? (state.kind === "dive" ? "Dive" : "Battle") : `${VARIANT_INFO[v].emoji} ${VARIANT_INFO[v].name}`;
}

/** Co-op: the team's combined depth against the target. */
function CoopBar({ state }: { state: RoomSnapshot }) {
  const c = state.dive?.coop;
  if (!c) return null;
  const qc = gameQuestions(state);
  const frac = Math.min(1, c.total / c.target);
  return (
    <div className="coop-bar" aria-label={`Team depth ${partyDepth(c.total, qc)} of ${partyDepth(c.target, qc)}`}>
      <div className="coop-bar-label">
        🤝 Team depth <b>{formatDepth(partyDepth(c.total, qc))}</b> <span className="muted">/ {formatDepth(partyDepth(c.target, qc))} target</span>
      </div>
      <div className="coop-bar-track">
        <motion.div className={`coop-bar-fill${frac >= 1 ? " coop-bar-fill--done" : ""}`} initial={false} animate={{ width: `${frac * 100}%` }} transition={{ duration: 0.8 }} />
      </div>
    </div>
  );
}

/** Bluff: pick which of the (anonymous) answers you think is the rarest. */
function DiveVote({ state, send }: { state: RoomSnapshot; send: Send }) {
  const d = state.dive!;
  const v = d.vote!;
  const now = useNow(250);
  const me = state.players.find((p) => p.id === state.you)!;
  const canVote = !me.spectator && !me.eliminated;
  const secs = Math.max(0, Math.ceil((v.endsAt - now) / 1000));
  const voters = state.players.filter((p) => !p.spectator && !p.eliminated);
  return (
    <div className="game">
      <div className="game-header">
        <span className="game-meta">
          Question {d.index + 1} of {d.total} · vote
        </span>
        <span className="game-meta">{secs}s</span>
      </div>
      <h2 className="prompt">{d.prompt}</h2>
      <p className="center">
        🎭 <b>Which answer is the rarest?</b> Spot it for +{DIVE_DEFAULTS.bluffBonus} bonus depth points.
      </p>
      <div className="vote-options">
        {v.options.map((o) => {
          const own = o.id === v.yourOptionId;
          const picked = o.id === v.yourVote;
          return (
            <button
              key={o.id}
              className={`vote-option${picked ? " vote-option--picked" : ""}${own ? " vote-option--own" : ""}`}
              disabled={!canVote || own}
              onClick={() => send({ type: "vote", optionId: o.id })}
            >
              {o.text}
              {own && <span className="muted small"> (yours)</span>}
              {picked && <span className="vote-check"> ✓</span>}
            </button>
          );
        })}
      </div>
      <p className="center muted small">
        {v.voted.length}/{voters.length} voted{v.yourVote ? " · you can change your vote until time's up" : ""}
      </p>
    </div>
  );
}

/** One dot per question, coloured by the tier you got once it's done (red for a miss). */
function ProgressDots({ total, current, tiers }: { total: number; current: number; tiers: Record<number, TierPoints | null> }) {
  return (
    <span className="game-progress" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const done = i in tiers;
        const tier = tiers[i];
        return (
          <span
            key={i}
            className={`dot${i === current ? " dot--current" : ""}${done ? (tier ? " dot--hit" : " dot--miss") : ""}`}
            style={tier ? ({ "--dot": tierInfo(tier).color } as React.CSSProperties) : undefined}
          />
        );
      })}
    </span>
  );
}

export const TEAM_NAMES = ["Team Coral", "Team Kelp"];

const penaltyLabel = (secs: number) => (secs === 0 ? "nothing" : `${secs}s`);

function TierBadge({ tier }: { tier: TierPoints | null }) {
  if (!tier) return <span className="tier-badge tier-badge--miss">{MISS_EMOJI}</span>;
  const t = tierInfo(tier);
  return (
    <span className="tier-badge" style={{ "--tier": t.color } as React.CSSProperties} title={t.name}>
      {t.emoji} {t.name}
    </span>
  );
}

export function RoomPage({
  code,
  onDepth,
  onBattle,
  onDivers,
}: {
  code: string;
  onDepth: (points: number) => void;
  /** Tells the app whether this is a Battle room, which has no depth gauge. */
  onBattle: (isBattle: boolean) => void;
  /** Everyone else's depth in a party Dive, for their submarines on the gauge. */
  onDivers: (divers: GaugeDiver[]) => void;
}) {
  const [nickname, setNickname] = useState<string | null>(getNickname());
  const { state, status, events, error, setError, send, revealAnswers, typing } = useRoom(code, nickname);
  const { settings } = useSettings();
  const lastEvent = events[events.length - 1];
  const [toasts, setToasts] = useState<{ id: number; text: string; tone?: string }[]>([]);

  const me = state?.players.find((p) => p.id === state.you);
  useEffect(() => {
    // Background depth follows the party scale, so shorter games still reach the deep zones.
    // In the lobby nobody has dived yet (old scores stay put even if the host changes the question count).
    if (state?.kind === "dive") onDepth(state.phase === "lobby" ? 0 : (me?.score ?? 0) * partyDepthScale(gameQuestions(state)));
  }, [state?.kind, state?.phase, state?.dive?.total, me?.score, onDepth]);

  // Everyone else's submarine on the depth gauge.
  const diversKey = state?.kind === "dive" ? `${state.phase === "lobby"}|${state.dive?.total}|` + state.players.map((p) => `${p.id}:${p.score}:${p.spectator}`).join("|") : "";
  useEffect(() => {
    if (!state || state.kind !== "dive" || state.phase === "lobby") return onDivers([]);
    const qc = gameQuestions(state);
    onDivers(
      state.players
        .filter((p) => p.id !== state.you && !p.spectator)
        .map((p) => ({ id: p.id, name: p.nickname, depth: partyDepth(p.score, qc), hue: hueOf(p.id) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diversKey, onDivers]);
  useEffect(() => () => onDivers([]), [onDivers]);

  // Your wrong guesses on each question, so you can say one "should count" at the reveal.
  const [myRejected, setMyRejected] = useState<Record<number, string[]>>({});
  const addRejected = useCallback((i: number, g: string) => setMyRejected((m) => ({ ...m, [i]: [...(m[i] ?? []), g] })), []);

  // Your tier on each question so far, for the coloured progress dots.
  const [myTiers, setMyTiers] = useState<Record<number, TierPoints | null>>({});
  const revealIndex = state?.dive?.reveal ? state.dive.index : null;
  useEffect(() => {
    if (state?.phase === "lobby") return setMyTiers({});
    if (revealIndex === null || !state?.dive?.reveal) return;
    const mine = state.dive.reveal.perPlayer.find((r) => r.playerId === state.you);
    setMyTiers((t) => ({ ...(revealIndex === 0 ? {} : t), [revealIndex]: mine?.tier ?? null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealIndex, state?.phase]);
  useEffect(() => {
    onBattle(state?.kind === "battle");
    return () => onBattle(false);
  }, [state?.kind, onBattle]);

  // Turn notable events into short toasts and sounds.
  useEffect(() => {
    if (!lastEvent || !state) return;
    const name = (id: string) => state.players.find((p) => p.id === id)?.nickname ?? "Someone";
    const push = (text: string, tone?: string) => {
      setToasts((t) => [...t.slice(-3), { id: lastEvent.id, text, tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== lastEvent.id)), 3200);
    };
    const play = (fn: () => void) => settings.sound && fn();
    switch (lastEvent.type) {
      case "taken":
        push(`Already taken: ${lastEvent.answerCanonical}`, "bad");
        play(sounds.thud);
        break;
      case "lifeLost":
        push(`${name(lastEvent.playerId)} lost a life (${lastEvent.livesLeft} left)`, "bad");
        play(sounds.thud);
        break;
      case "eliminated":
        push(`${name(lastEvent.playerId)} is out!`, "bad");
        break;
      case "turnResult":
        push(`${name(lastEvent.playerId)}: ${lastEvent.canonical} (${tierInfo(lastEvent.tier).name})`, "good");
        play(() => sounds.ping(lastEvent.tier));
        break;
      case "guessResult":
        if (lastEvent.accepted) play(() => sounds.ping(lastEvent.tier ?? 10));
        else play(sounds.thud);
        break;
    }
  }, [lastEvent, state, settings.sound]);

  if (!nickname) {
    return (
      <div className="room">
        <NicknamePrompt onDone={setNickname} title={`Join room ${code}`} />
      </div>
    );
  }

  if (status === "kicked") {
    return (
      <div className="room card center">
        <p>The host removed you from this room.</p>
        <button className="btn" onClick={() => navigate("/party")}>
          Back to Party
        </button>
      </div>
    );
  }

  if (status === "gone") {
    return (
      <div className="room card center">
        <p>This room has closed.</p>
        <button className="btn" onClick={() => navigate("/party")}>
          Back to Party
        </button>
      </div>
    );
  }

  if (!state || !me) {
    return (
      <div className="room">
        <div className="loading">{error ?? (status === "closed" ? "Reconnecting…" : "Connecting…")}</div>
        {error && (
          <div className="center">
            <button className="btn" onClick={() => navigate("/party")}>
              Back to Party
            </button>
          </div>
        )}
      </div>
    );
  }

  const isHost = state.hostId === state.you;
  return (
    <div className="room">
      <header className="room-head">
        <button className="link-btn" onClick={() => navigate("/party")}>
          ← Leave
        </button>
        <span className="room-code" title="Room code">
          {variantName(state)} · <b>{state.code}</b>
        </span>
        <span className={`conn conn--${status}`}>{status === "open" ? "Live" : "Reconnecting…"}</span>
      </header>

      {state.phase === "lobby" && <Lobby state={state} isHost={isHost} send={send} />}
      {state.kind === "dive" && state.phase === "question" && <DiveQuestion state={state} send={send} events={events} reducedMotion={settings.reducedMotion} tiers={myTiers} onRejected={addRejected} />}
      {state.kind === "dive" && state.phase === "vote" && <DiveVote state={state} send={send} />}
      {state.kind === "dive" && state.phase === "reveal" && <DiveReveal state={state} isHost={isHost} send={send} answers={revealAnswers} tiers={myTiers} rejected={myRejected[state.dive?.index ?? -1] ?? []} />}
      {state.kind === "dive" && state.phase === "over" && <DiveFinale state={state} isHost={isHost} send={send} reducedMotion={settings.reducedMotion} />}
      {state.kind === "battle" && (state.phase === "turn" || state.phase === "rotate") && (
        <BattleView state={state} send={send} typing={typing} events={events} reducedMotion={settings.reducedMotion} />
      )}
      {state.kind === "battle" && state.phase === "over" && <BattleOver state={state} isHost={isHost} send={send} />}

      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} className={`toast${t.tone ? ` toast--${t.tone}` : ""}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {t.text}
            </motion.div>
          ))}
          {error && (
            <motion.div key="err" className="toast toast--bad" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setError(null)}>
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function PlayerList({ state, showLives = false, active, send }: { state: RoomSnapshot; showLives?: boolean; active?: string | null; send?: Send }) {
  const isHost = state.hostId === state.you;
  return (
    <ul className="player-list">
      {state.players.map((p) => (
        <li
          key={p.id}
          className={`player${p.connected ? "" : " player--away"}${p.eliminated ? " player--out" : ""}${active === p.id ? " player--active" : ""}${p.id === state.you ? " player--you" : ""}`}
        >
          <span className="player-name">
            {state.hostId === p.id && <span title="Host">👑 </span>}
            {p.nickname}
            {p.id === state.you && <span className="muted small"> (you)</span>}
            {p.spectator && <span className="muted small"> · watching</span>}
          </span>
          {showLives && !p.spectator && <span className="lives">{p.eliminated ? "out" : "❤️".repeat(Math.max(0, p.lives))}</span>}
          {state.phase === "question" && !p.spectator && <span className="lock">{p.locked ? "🔒" : "…"}</span>}
          {isHost && send && p.id !== state.you && (
            <button
              className="kick-btn"
              title={`Remove ${p.nickname} from the room`}
              aria-label={`Remove ${p.nickname}`}
              onClick={() => confirm(`Remove ${p.nickname} from the room? They won't be able to rejoin.`) && send({ type: "kick", playerId: p.id })}
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Lobby({ state, isHost, send }: { state: RoomSnapshot; isHost: boolean; send: Send }) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/room/${state.code}`;
  const set = (patch: Partial<DiveSettings & BattleSettings>) => isHost && send({ type: "settings", settings: patch });
  const s = state.settings as DiveSettings & BattleSettings;
  const variantKey = ((state.settings as { variant?: string }).variant ?? "classic") as keyof typeof VARIANT_INFO;
  const connected = state.players.filter((p) => p.connected).length;
  const canStart = state.kind === "dive" ? connected >= 1 : connected >= BATTLE_DEFAULTS.minPlayers;

  return (
    <div className="lobby">
      <div className="card lobby-code">
        <div className="muted small">Room code</div>
        <div className="big-code">{state.code}</div>
        <button
          className="btn btn--ghost"
          onClick={() => {
            void navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Link copied!" : "Copy invite link"}
        </button>
      </div>
      <div className="lobby-cols">
        <div className="card">
          <h3>
            Players ({state.players.length}/{state.kind === "dive" ? DIVE_DEFAULTS.maxPlayers : BATTLE_DEFAULTS.maxPlayers})
          </h3>
          <PlayerList state={state} send={send} />
        </div>
        <div className="card settings-card">
          <h3>Settings {isHost ? "" : <span className="muted small">(host picks)</span>}</h3>
          <label className="field">
            <span>Mode</span>
            <select value={variantKey} disabled={!isHost} onChange={(e) => set({ variant: e.target.value as never })}>
              {(state.kind === "dive" ? (["classic", "coop", "shark", "bluff"] as const) : (["classic", "hotpotato", "relay"] as const)).map((v) => (
                <option key={v} value={v}>
                  {VARIANT_INFO[v].emoji} {v === "classic" ? (state.kind === "dive" ? "Classic Dive" : "Classic Battle") : VARIANT_INFO[v].name}
                </option>
              ))}
            </select>
          </label>
          {variantKey !== "classic" && <p className="muted small variant-blurb">{VARIANT_INFO[variantKey].blurb}</p>}
          <label className="field">
            <span>Questions from</span>
            <select value={s.source} disabled={!isHost} onChange={(e) => set({ source: e.target.value as DiveSettings["source"] })}>
              <option value="unlimited">Random Unlimited</option>
              <option value="daily">Today's Daily set</option>
              <option value="category">One category</option>
            </select>
          </label>
          {s.source === "category" && (
            <label className="field">
              <span>Category</span>
              <select value={s.category ?? ""} disabled={!isHost} onChange={(e) => set({ category: e.target.value as Category })}>
                <option value="">Pick one…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace("-", " & ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {state.kind === "dive" ? (
            <>
              <label className="field">
                <span>Questions: {s.questionCount}</span>
                <input type="range" min={DIVE_DEFAULTS.questionCountMin} max={DIVE_DEFAULTS.questionCountMax} value={s.questionCount} disabled={!isHost} onChange={(e) => set({ questionCount: Number(e.target.value) })} />
              </label>
              <div className="field">
                <span>Timer</span>
                <div className="seg">
                  {DIVE_DEFAULTS.timerOptions.map((t) => (
                    <button key={t} className={`seg-btn${s.timerSeconds === t ? " seg-btn--on" : ""}`} disabled={!isHost} onClick={() => set({ timerSeconds: t })}>
                      {t === 60 ? "1 min" : `${t}s`}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Wrong guess costs: {penaltyLabel(s.penaltySeconds ?? DIVE_DEFAULTS.wrongGuessPenaltySeconds)}</span>
                <input type="range" min={0} max={DIVE_DEFAULTS.penaltyMax} value={s.penaltySeconds ?? DIVE_DEFAULTS.wrongGuessPenaltySeconds} disabled={!isHost} onChange={(e) => set({ penaltySeconds: Number(e.target.value) })} />
              </label>
              <label className="toggle-row">
                <span>
                  <span className="toggle-label">Unique answers</span>
                  <span className="muted small">Same answer as someone else = half points</span>
                </span>
                <input type="checkbox" className="toggle" checked={s.uniqueAnswers} disabled={!isHost} onChange={(e) => set({ uniqueAnswers: e.target.checked })} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Lives: {s.lives}</span>
                <input type="range" min={BATTLE_DEFAULTS.livesMin} max={BATTLE_DEFAULTS.livesMax} value={s.lives} disabled={!isHost} onChange={(e) => set({ lives: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>Base time: {s.baseSeconds}s</span>
                <input type="range" min={BATTLE_DEFAULTS.baseSecondsMin} max={BATTLE_DEFAULTS.baseSecondsMax} value={s.baseSeconds} disabled={!isHost} onChange={(e) => set({ baseSeconds: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>Wrong or taken answer costs: {penaltyLabel(s.penaltySeconds ?? BATTLE_DEFAULTS.wrongGuessPenaltySeconds)}</span>
                <input type="range" min={0} max={BATTLE_DEFAULTS.penaltyMax} value={s.penaltySeconds ?? BATTLE_DEFAULTS.wrongGuessPenaltySeconds} disabled={!isHost} onChange={(e) => set({ penaltySeconds: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>New prompt after {s.failedTurnsToRotate} failed turn(s)</span>
                <input type="range" min={1} max={5} value={s.failedTurnsToRotate} disabled={!isHost} onChange={(e) => set({ failedTurnsToRotate: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>…or after {s.acceptsToRotate ?? "2 × players"} accepted answers</span>
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={s.acceptsToRotate ?? 0}
                  disabled={!isHost}
                  onChange={(e) => set({ acceptsToRotate: Number(e.target.value) === 0 ? null : Number(e.target.value) })}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <span className="toggle-label">Speed-up</span>
                  <span className="muted small">Base time drops 1s each new prompt (min 4s)</span>
                </span>
                <input type="checkbox" className="toggle" checked={s.speedUp} disabled={!isHost} onChange={(e) => set({ speedUp: e.target.checked })} />
              </label>
            </>
          )}
        </div>
      </div>
      <div className="center">
        {isHost ? (
          <button className="btn btn--primary big-btn" disabled={!canStart} onClick={() => send({ type: "start" })}>
            {canStart ? "Start game" : `Waiting for ${BATTLE_DEFAULTS.minPlayers} players…`}
          </button>
        ) : (
          <p className="muted">Waiting for the host to start…</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dive
// ---------------------------------------------------------------------------

function DiveQuestion({
  state,
  send,
  events,
  reducedMotion,
  tiers,
  onRejected,
}: {
  state: RoomSnapshot;
  send: Send;
  events: RoomEvent[];
  reducedMotion: boolean;
  tiers: Record<number, TierPoints | null>;
  onRejected: (index: number, guess: string) => void;
}) {
  const d = state.dive!;
  const lastSent = useRef("");
  const [ask, setAsk] = useState<{ guess: string; canonical: string } | null>(null);
  const me = state.players.find((p) => p.id === state.you)!;
  const [text, setText] = useState("");
  const [timeUp, setTimeUp] = useState(false);
  const [pops, setPops] = useState<number[]>([]);
  const shake = useAnimationControls();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSeen = useRef(events.length ? events[events.length - 1].id : 0);

  useEffect(() => {
    setTimeUp(false);
    setText("");
    setAsk(null);
    inputRef.current?.focus();
  }, [d.index]);

  useEffect(() => {
    const fresh = events.filter((e) => e.id > lastSeen.current);
    if (!fresh.length) return;
    lastSeen.current = fresh[fresh.length - 1].id;
    for (const e of fresh) {
      if (e.type === "guessResult" && !e.accepted && e.reason === "confirm" && e.canonical) {
        setAsk({ guess: lastSent.current, canonical: e.canonical });
        continue;
      }
      if (e.type === "guessResult" && !e.accepted) {
        const k = e.id;
        if (lastSent.current && e.reason !== "taken") onRejected(d.index, lastSent.current);
        if (((state.settings as DiveSettings).penaltySeconds ?? DIVE_DEFAULTS.wrongGuessPenaltySeconds) > 0) setPops((p) => [...p, k]);
        setTimeout(() => setPops((p) => p.filter((x) => x !== k)), 1000);
        if (!reducedMotion) void shake.start({ x: [0, -10, 8, -6, 4, 0], transition: { duration: 0.4 } });
      }
    }
  }, [events, shake, reducedMotion]);

  const submit = () => {
    if (!text.trim() || timeUp) return;
    lastSent.current = text.trim();
    send({ type: "guess", text: text.trim() });
    setText("");
  };

  return (
    <div className="game">
      <div className="game-header">
        <span className="game-meta">
          Question {d.index + 1} of {d.total}
        </span>
        <ProgressDots total={d.total} current={d.index} tiers={tiers} />
      </div>
      <motion.h2 key={d.index} className="prompt" initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        {d.prompt}
      </motion.h2>
      <div className="category-tag">{d.category.replace("-", " & ")}</div>
      <CoopBar state={state} />
      {me.spectator ? (
        <p className="center muted">You're watching this game. You'll play in the next one.</p>
      ) : me.eliminated ? (
        <div className="locked-card bitten-card">
          <div className="bitten-emoji">🦈</div>
          <div>
            <b>You were bitten!</b>
          </div>
          <div className="muted small">Watch the others try to survive.</div>
          <RoundClock endsAt={d.endsAt} totalMs={(state.settings as DiveSettings).timerSeconds * 1000} />
        </div>
      ) : d.yourAnswer ? (
        <div className="locked-card" style={{ "--tier": tierInfo(d.yourAnswer.tier).color } as React.CSSProperties}>
          <div>Locked in: <b>{d.yourAnswer.canonical}</b></div>
          <TierBadge tier={d.yourAnswer.tier} />
          <div className="muted small">Waiting for everyone else…</div>
          <RoundClock endsAt={d.endsAt} totalMs={(state.settings as DiveSettings).timerSeconds * 1000} />
        </div>
      ) : (
        <motion.div animate={shake} className="input-wrap">
          <TimerRing endsAt={d.yourEndsAt} totalMs={(state.settings as DiveSettings).timerSeconds * 1000} running={!timeUp} onExpire={() => setTimeUp(true)}>
            <input
              ref={inputRef}
              className="answer-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())}
              placeholder={timeUp ? "Time's up" : "Type an answer…"}
              disabled={timeUp}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={60}
              autoFocus
            />
          </TimerRing>
          <AnimatePresence>
            {pops.map((k) => (
              <motion.span key={k} className="penalty-pop" initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 0], y: -40 }} exit={{ opacity: 0 }} transition={{ duration: 0.9 }}>
                −{(state.settings as DiveSettings).penaltySeconds ?? DIVE_DEFAULTS.wrongGuessPenaltySeconds}s
              </motion.span>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      {ask && !d.yourAnswer && (
        <DidYouMean
          guess={ask.guess}
          canonical={ask.canonical}
          onYes={() => {
            send({ type: "guess", text: ask.guess, confirm: true });
            setAsk(null);
            setText("");
          }}
          onNo={() => {
            onRejected(d.index, ask.guess);
            setAsk(null);
            setText("");
            inputRef.current?.focus();
          }}
        />
      )}
      <p className="hint">
        <kbd>Enter ↵</kbd> to submit · players who've locked in show a 🔒
      </p>
      <div className="card">
        <PlayerList state={state} send={send} />
      </div>
    </div>
  );
}

function DiveReveal({
  state,
  isHost,
  send,
  answers,
  tiers,
  rejected,
}: {
  state: RoomSnapshot;
  isHost: boolean;
  send: Send;
  answers: RevealAnswer[];
  tiers: Record<number, TierPoints | null>;
  rejected: string[];
}) {
  const d = state.dive!;
  const reveal = d.reveal!;
  const now = useNow();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [d.index]);
  // Show the old order for a moment, then let the rows slide to their new ranks.
  const ordered = [...reveal.leaderboard].sort((a, b) => (settled ? a.rank - b.rank : a.previousRank - b.previousRank));
  const mine = reveal.perPlayer.find((r) => r.playerId === state.you);
  const secs = Math.max(0, Math.ceil((reveal.nextAt - now) / 1000));

  return (
    <div className="dive-reveal">
      <CoopBar state={state} />
      <div className="game-header">
        <span className="game-meta">
          Question {d.index + 1} of {d.total}
        </span>
        <ProgressDots total={d.total} current={d.index} tiers={tiers} />
      </div>
      <h2 className="prompt small-prompt">{d.prompt}</h2>
      <div className="reveal-cols">
        <div className="card">
          <h3>Answers</h3>
          <ul className="reveal-rows">
            {reveal.perPlayer.map((r) => (
              <li key={r.playerId} className={r.playerId === state.you ? "me" : ""}>
                <span className="reveal-name">{r.nickname}</span>
                <span className="reveal-ans">{r.canonical ?? "—"}</span>
                <TierBadge tier={r.tier} />
                <span className="reveal-pts">
                  {r.bitten && <span className="tag tag--shark" title="Bitten by the shark">🦈</span>}
                  {r.votedRight && <span className="tag tag--bluff" title={`Spotted the rarest answer: +${DIVE_DEFAULTS.bluffBonus}`}>🎭</span>}
                  +{formatDepth(partyDepth(r.points, gameQuestions(state)))}
                  {r.shared && <span className="muted small" title="Someone else gave the same answer"> ½</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>Leaderboard</h3>
          <ol className="leaderboard">
            {ordered.map((r) => (
              <motion.li key={r.playerId} layout transition={{ type: "spring", stiffness: 300, damping: 30 }} className={r.playerId === state.you ? "me" : ""}>
                <span className="lb-rank">{settled ? r.rank : r.previousRank}</span>
                <span className="lb-name">{r.nickname}</span>
                <span className="lb-depth">{formatDepth(partyDepth(r.score, gameQuestions(state)))}</span>
                {settled && r.rank < r.previousRank && <span className="lb-move up">▲</span>}
                {settled && r.rank > r.previousRank && <span className="lb-move down">▼</span>}
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
      <div className="center">
        <p className="muted small">
          {d.index + 1 < d.total ? `Next question in ${secs}s` : `Final results in ${secs}s`}
          {mine && mine.tier ? ` · you dove ${mine.points * 10} m` : ""}
        </p>
        {isHost && (
          <button className="btn" onClick={() => send({ type: "next" })}>
            {d.index + 1 < d.total ? "Next question now" : "Show results now"}
          </button>
        )}
      </div>
      <ShouldCount key={d.index} guesses={rejected} onReport={(g) => api.reportPrompt(d.prompt, g)} />
      {answers.length > 0 && (
        <div className="answers-details">
          <h3 className="answers-heading">All {answers.length} valid answers</h3>
          <RevealPanel reveal={{ index: d.index, prompt: d.prompt, answers, playerAnswerId: null }} />
        </div>
      )}
    </div>
  );
}

function DiveFinale({ state, isHost, send, reducedMotion }: { state: RoomSnapshot; isHost: boolean; send: Send; reducedMotion: boolean }) {
  const results = state.results?.results ?? [];
  const [showPodium, setShowPodium] = useState(reducedMotion);
  const [podiumDone, setPodiumDone] = useState(reducedMotion);
  const onPodiumDone = useCallback(() => setPodiumDone(true), []);
  const maxDepth = Math.max(1000, ...results.map((r) => r.depth));
  useEffect(() => {
    if (reducedMotion) return;
    const t = setTimeout(() => setShowPodium(true), 4800);
    return () => clearTimeout(t);
  }, [reducedMotion]);
  const lanes = results.slice(0, 8);
  const coop = state.results?.coop;
  const variant = (state.settings as DiveSettings).variant ?? "classic";
  const qc = gameQuestions(state);

  return (
    <div className="finale">
      {coop && (
        <motion.div className={`card variant-result ${coop.success ? "variant-result--win" : "variant-result--lose"}`} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <div className="variant-result-big">{coop.success ? "🤝 You made it together!" : "🌊 So close!"}</div>
          <div>
            Team depth <b>{formatDepth(partyDepth(coop.total, qc))}</b> of {formatDepth(partyDepth(coop.target, qc))}
          </div>
        </motion.div>
      )}
      {variant === "shark" && (
        <motion.div className="card variant-result" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <div className="variant-result-big">🦈 {results.filter((r) => r.rank === 1).map((r) => r.nickname).join(" & ") || "Nobody"} survived the shark!</div>
        </motion.div>
      )}
      {!showPodium ? (
        <div className="race card">
          <h3 className="center">The depth race</h3>
          <div className="race-lanes">
            {lanes.map((r, i) => {
              const steps = [0, ...r.depthTrail].map((dpt) => (dpt / maxDepth) * 260);
              return (
                <div key={r.playerId} className="race-lane">
                  <motion.div
                    className="race-diver"
                    initial={{ y: 0 }}
                    animate={{ y: steps }}
                    transition={{ duration: 4, ease: "easeInOut", delay: i * 0.05 }}
                  >
                    🤿
                  </motion.div>
                  <div className="race-name">{r.nickname}</div>
                </div>
              );
            })}
          </div>
          <button className="link-btn center-block" onClick={() => setShowPodium(true)}>
            Skip
          </button>
        </div>
      ) : (
        <>
          <Podium results={results} you={state.you} reducedMotion={reducedMotion} onDone={onPodiumDone} />
          <motion.div
            className="finale-rest"
            initial={reducedMotion ? false : { opacity: 0, y: 30 }}
            animate={podiumDone ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            {state.results?.bestAnswer && (
              <p className="center">
                Best answer: <b>{state.results.bestAnswer.canonical}</b> by {state.results.bestAnswer.nickname} ({tierInfo(state.results.bestAnswer.tier).name})
              </p>
            )}
            {state.results?.recap && state.results.recap.length > 0 && <AnswerRecap recap={state.results.recap} you={state.you} questionCount={gameQuestions(state)} />}
            <div className="card">
              <ol className="leaderboard">
                {results.map((r) => (
                  <li key={r.playerId} className={r.playerId === state.you ? "me" : ""}>
                    <span className="lb-rank">{r.rank}</span>
                    <span className="lb-name">{r.nickname}</span>
                    <span className="lb-depth">{formatDepth(r.depth)}</span>
                    <span className="muted small">{(r.timeUsedMs / 1000).toFixed(1)}s</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="center">
              {isHost ? (
                <button className="btn btn--primary" onClick={() => send({ type: "lobby" })}>
                  Back to the lobby
                </button>
              ) : (
                <p className="muted">The host can start another round.</p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}

/** Every question from the game with every player's answer, shown at the end of a Dive. */
function AnswerRecap({ recap, you, questionCount }: { recap: QuestionRecap[]; you: string; questionCount: number }) {
  return (
    <div className="card recap">
      <h3>Everyone's answers</h3>
      {recap.map((q, i) => (
        <div key={i} className="recap-q">
          <div className="recap-prompt">
            <span className="muted small">Q{i + 1}</span> {q.prompt}
          </div>
          <ul className="reveal-rows">
            {q.perPlayer.map((r) => (
              <li key={r.playerId} className={r.playerId === you ? "me" : ""}>
                <span className="reveal-name">{r.nickname}</span>
                <span className="reveal-ans">{r.canonical ?? "—"}</span>
                <TierBadge tier={r.tier} />
                <span className="reveal-pts">+{formatDepth(partyDepth(r.points, questionCount))}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

function BattleView({
  state,
  send,
  typing,
  events,
  reducedMotion,
}: {
  state: RoomSnapshot;
  send: Send;
  typing: { playerId: string; text: string } | null;
  events: RoomEvent[];
  reducedMotion: boolean;
}) {
  const b = state.battle!;
  const me = state.players.find((p) => p.id === state.you)!;
  const myTurn = b.turnPlayerId === state.you;
  const active = state.players.find((p) => p.id === b.turnPlayerId);
  const out = me.eliminated || me.spectator;
  const [text, setText] = useState("");
  const [waitHint, setWaitHint] = useState(false);
  const [letterHint, setLetterHint] = useState(false);
  const [ask, setAsk] = useState<{ guess: string; canonical: string } | null>(null);
  useEffect(() => setAsk(null), [b.turnPlayerId, b.prompt]);
  // Your wrong guesses on this prompt, for "this should count".
  const [wrong, setWrong] = useState<string[]>([]);
  const lastSent = useRef("");
  useEffect(() => setWrong([]), [b.prompt]);
  const lastTypingSent = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const shake = useAnimationControls();
  const lastSeen = useRef(events.length ? events[events.length - 1].id : 0);
  const now = useNow(200);

  // Your draft carries over: type while you wait, then hit Enter when the fish arrives.
  useEffect(() => {
    setWaitHint(false);
    if (!myTurn) return;
    inputRef.current?.focus();
    if (text) send({ type: "typing", text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, b.turnPlayerId]);

  useEffect(() => {
    const fresh = events.filter((e) => e.id > lastSeen.current);
    if (!fresh.length) return;
    lastSeen.current = fresh[fresh.length - 1].id;
    if (fresh.some((e) => e.type === "guessResult" && !e.accepted && e.reason !== "taken" && e.reason !== "confirm") && lastSent.current) {
      const g = lastSent.current;
      setWrong((w) => (w.includes(g) ? w : [...w, g]));
    }
    const c = fresh.find((e) => e.type === "guessResult" && !e.accepted && e.reason === "confirm");
    if (c && c.type === "guessResult" && c.canonical) setAsk({ guess: lastSent.current, canonical: c.canonical });
    setLetterHint(fresh.some((e) => e.type === "guessResult" && !e.accepted && e.reason === "letter"));
    if (fresh.some((e) => e.type === "guessResult" && !e.accepted && e.reason !== "confirm") && !reducedMotion) {
      void shake.start({ x: [0, -10, 8, -6, 4, 0], transition: { duration: 0.4 } });
    }
  }, [events, shake, reducedMotion]);

  // Live typing: send what you've typed about 10 times a second.
  const onType = (v: string) => {
    setText(v);
    if (!myTurn) return; // drafts stay private until it's your turn
    const t = Date.now();
    if (t - lastTypingSent.current >= 1000 / BATTLE_DEFAULTS.typingUpdatesPerSecond) {
      lastTypingSent.current = t;
      send({ type: "typing", text: v });
    }
  };

  const submit = () => {
    const guess = text.trim();
    if (!guess) return;
    if (!myTurn && !out) return setWaitHint(true);
    lastSent.current = guess;
    send({ type: "guess", text: guess });
    setText("");
    if (myTurn) send({ type: "typing", text: "" });
  };
  const input = (
    <motion.div animate={shake} className="input-wrap">
      <input
        ref={inputRef}
        className={`answer-input answer-input--battle${myTurn ? "" : " answer-input--waiting"}`}
        value={text}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={out ? "You're out. Guess just for fun…" : myTurn ? "Quick, pass the pufferfish!" : "Get your answer ready…"}
        aria-label="Your answer"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={60}
        autoFocus
      />
    </motion.div>
  );

  const showRotate = state.phase === "rotate";
  const startsIn = Math.max(0, Math.ceil((b.turnEndsAt - now) / 1000));

  return (
    <div className="battle">
      <AnimatePresence>
        {showRotate && (
          <motion.div className="new-prompt" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="new-prompt-label">NEW PROMPT</div>
            <div className="new-prompt-text">{b.prompt}</div>
            <div className="muted small">Base time is now {b.baseSeconds}s</div>
          </motion.div>
        )}
      </AnimatePresence>
      <PufferArena
        state={state}
        typing={typing}
        events={events}
        reducedMotion={reducedMotion}
        input={
          <>
            {input}
            {ask && myTurn && (
              <DidYouMean
                guess={ask.guess}
                canonical={ask.canonical}
                onYes={() => {
                  lastSent.current = ask.guess;
                  send({ type: "guess", text: ask.guess, confirm: true });
                  setAsk(null);
                }}
                onNo={() => {
                  setWrong((w) => (w.includes(ask.guess) ? w : [...w, ask.guess]));
                  setAsk(null);
                  inputRef.current?.focus();
                }}
              />
            )}
          </>
        }
      />
      {!active && showRotate && <p className="hint">Next turn in {startsIn}s</p>}

      <div className="battle-cols">
        <div className="battle-main">
          <p className="hint">
            {myTurn && letterHint && b.letter ? (
              <b>That's a real answer, but it has to start with {b.letter.toUpperCase()}!</b>
            ) : myTurn ? (
              <>
                <kbd>Enter ↵</kbd> to submit · wrong or taken answers cost {penaltyLabel((state.settings as BattleSettings).penaltySeconds ?? BATTLE_DEFAULTS.wrongGuessPenaltySeconds)} · good answers fill your life circle (🐋 fills it all, 🦑 half, 🐚 a quarter…) and a full circle is +1 life
              </>
            ) : out ? (
              "You're out, but you can still guess for fun."
            ) : waitHint ? (
              <b>Hold on, it isn't your turn yet. Your answer is saved; press Enter when the pufferfish reaches you.</b>
            ) : active ? (
              `${active.nickname} has the pufferfish. Type your answer now and send it when it's your turn.`
            ) : (
              "Get ready: answers already used can't be reused."
            )}
          </p>
          <div className="card">
            <h3>Used on this prompt ({b.used.length})</h3>
            <ul className="reveal-chips">
              {b.used.map((u, i) => (
                <li key={i} className="chip" style={{ "--tier": tierInfo(u.tier).color } as React.CSSProperties} title={state.players.find((p) => p.id === u.byPlayerId)?.nickname}>
                  {tierInfo(u.tier).emoji} {u.canonical}
                </li>
              ))}
            </ul>
            <ShouldCount key={b.prompt} guesses={wrong} onReport={(g) => api.reportPrompt(b.prompt, g)} />
          </div>
        </div>
        <aside className="battle-side">
          <div className="card">
            <h3>Spectator guesses</h3>
            <ul className="spectator-list">
              {b.spectatorGuesses.map((g, i) => (
                <li key={i}>
                  <b>{g.nickname}</b>: {g.text} {g.canonical ? <TierBadge tier={g.tier} /> : <span className="muted">✗</span>}
                </li>
              ))}
              {!b.spectatorGuesses.length && <li className="muted small">Eliminated players can keep guessing here (unscored).</li>}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BattleOver({ state, isHost, send }: { state: RoomSnapshot; isHost: boolean; send: Send }) {
  const results = state.results?.results ?? [];
  const winner = results[0];
  const best = state.results?.bestAnswer;
  const sorted = useMemo(() => results, [results]);
  return (
    <div className="finale">
      <motion.div className="card end-hero" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        {typeof state.results?.winningTeam === "number" ? (
          <>
            <div className="muted small">Relay winners</div>
            <div className="end-depth">
              🏆 <span className={`team-name team-name--${state.results.winningTeam}`}>{TEAM_NAMES[state.results.winningTeam]}</span>
            </div>
            <div>{results.filter((r) => r.team === state.results!.winningTeam).map((r) => r.nickname).join(", ")}</div>
          </>
        ) : (
          <>
            <div className="muted small">Last diver standing</div>
            <div className="end-depth">🏆 {winner?.nickname ?? "Nobody"}</div>
          </>
        )}
        {best && (
          <p>
            Best answer of the game: <b>{best.canonical}</b> by {best.nickname} <TierBadge tier={best.tier} />
            <br />
            <span className="muted small">{best.prompt}</span>
          </p>
        )}
      </motion.div>
      <div className="card">
        <ol className="leaderboard">
          {sorted.map((r) => (
            <li key={r.playerId} className={r.playerId === state.you ? "me" : ""}>
              <span className="lb-rank">{r.rank}</span>
              <span className="lb-name">{r.nickname}</span>
              <span className="lb-depth">{r.score} pts</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="center">
        {isHost ? (
          <button className="btn btn--primary" onClick={() => send({ type: "lobby" })}>
            Back to the lobby
          </button>
        ) : (
          <p className="muted">The host can start another round.</p>
        )}
      </div>
    </div>
  );
}
