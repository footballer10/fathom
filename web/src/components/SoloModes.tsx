import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { TIERS, formatDepth, tierInfo } from "@fathom/shared";
import type { TierPoints } from "@fathom/shared";
import { api, serverNow } from "../api";
import type { PracticeQuestion } from "../api";
import { navigate } from "../router";
import { TimerRing } from "./TimerRing";

export type SoloMode = "sprint" | "ladder" | "roulette" | "five";

export const SOLO_MODES: Record<SoloMode, { name: string; emoji: string; short: string; rules: string[] }> = {
  sprint: {
    name: "Sprint",
    emoji: "⚡",
    short: "60 seconds. Answer as many prompts as you can.",
    rules: ["You have 60 seconds in total.", "Every accepted answer adds its depth, then the next prompt appears straight away.", "Stuck? Skip to a new prompt any time."],
  },
  ladder: {
    name: "Ladder",
    emoji: "🪜",
    short: "Every answer must be as rare as the last, or rarer.",
    rules: ["Answer each prompt within 25 seconds.", "Each answer has to be the same tier as your last one, or rarer.", "A more common answer, or running out of time, ends the climb."],
  },
  roulette: {
    name: "Rarity Roulette",
    emoji: "🎯",
    short: "Hit the exact tier each prompt asks for.",
    rules: ["7 prompts, 25 seconds each.", "Each one names a tier, like \"give me a Rare\".", "Too common or too rare doesn't count: keep trying until you hit it."],
  },
  five: {
    name: "Five Answers",
    emoji: "🖐️",
    short: "One prompt, five different answers, 60 seconds.",
    rules: ["One big prompt and 60 seconds.", "Name five different answers.", "Your score is the total depth of all five."],
  },
};

const ROULETTE_TARGETS: TierPoints[] = [10, 30, 30, 60, 60, 85];
const ROUND_SECONDS = 25;

type Played = { prompt: string; canonical: string | null; tier: TierPoints | null; note?: string };

function getBest(mode: SoloMode): number {
  try {
    return Number(localStorage.getItem(`fathom.best.${mode}`)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(mode: SoloMode, score: number) {
  try {
    if (score > getBest(mode)) localStorage.setItem(`fathom.best.${mode}`, String(score));
  } catch {
    /* ignore */
  }
}

/** The four quick solo modes, all played against the practice API (your Unlimited isn't used up). */
export function SoloModePage({ mode, reducedMotion, onDepth }: { mode: SoloMode; reducedMotion: boolean; onDepth: (points: number) => void }) {
  const info = SOLO_MODES[mode];
  const [phase, setPhase] = useState<"intro" | "play" | "done">("intro");
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{ score: number; label: string; played: Played[] } | null>(null);
  const best = getBest(mode);

  if (phase === "play") {
    return (
      <SoloRun
        key={runKey}
        mode={mode}
        reducedMotion={reducedMotion}
        onDepth={onDepth}
        onDone={(r) => {
          const wasBest = r.score > getBest(mode);
          saveBest(mode, r.score);
          setResult({ ...r, label: wasBest && r.score > 0 ? `${r.label} · new personal best!` : r.label });
          setPhase("done");
        }}
      />
    );
  }

  return (
    <div className="solo-mode">
      <div className="page-head">
        <button className="link-btn" onClick={() => navigate("/")}>
          ← Surface
        </button>
        <h2>
          {info.emoji} {info.name}
        </h2>
      </div>
      {phase === "done" && result ? (
        <motion.div className="card end-hero" initial={reducedMotion ? false : { scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <div className="muted small">{info.name}</div>
          <div className="end-depth">{scoreText(mode, result.score)}</div>
          <div>{result.label}</div>
          <div className="muted small">Personal best: {scoreText(mode, Math.max(best, result.score))}</div>
        </motion.div>
      ) : (
        <div className="card solo-rules">
          <p>{info.short}</p>
          <ul>
            {info.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {best > 0 && <p className="muted small">Your best: {scoreText(mode, best)}</p>}
          <p className="muted small">Uses random Unlimited prompts, but doesn't use up your Unlimited questions. Wrong guesses are free.</p>
        </div>
      )}
      <div className="center solo-actions">
        <button
          className="btn btn--primary big-btn"
          onClick={() => {
            setRunKey((k) => k + 1);
            setPhase("play");
          }}
          autoFocus
        >
          {phase === "done" ? "Play again" : "Start"}
        </button>
      </div>
      {phase === "done" && result && result.played.length > 0 && (
        <div className="card">
          <h3>Your run</h3>
          <ul className="end-plays">
            {result.played.map((p, i) => (
              <li key={i} className="solo-played">
                <span className="end-play-prompt">{p.prompt}</span>
                <span className="end-play-answer" style={{ color: p.tier ? tierInfo(p.tier).color : undefined }}>
                  {p.tier ? `${tierInfo(p.tier).emoji} ${p.canonical}` : p.note ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function scoreText(mode: SoloMode, score: number) {
  if (mode === "ladder") return `${score} rung${score === 1 ? "" : "s"}`;
  if (mode === "roulette") return `${score}/7 hits`;
  return formatDepth(score * 10);
}

function SoloRun({
  mode,
  reducedMotion,
  onDepth,
  onDone,
}: {
  mode: SoloMode;
  reducedMotion: boolean;
  onDepth: (points: number) => void;
  onDone: (r: { score: number; label: string; played: Played[] }) => void;
}) {
  const [q, setQ] = useState<PracticeQuestion | null>(null);
  const [text, setText] = useState("");
  const [endsAt, setEndsAt] = useState(0);
  const [totalMs, setTotalMs] = useState(ROUND_SECONDS * 1000);
  const [msg, setMsg] = useState<{ text: string; tone: "good" | "bad" | "info" } | null>(null);
  const [flash, setFlash] = useState<{ id: number; tier: TierPoints; text: string } | null>(null);
  const [points, setPoints] = useState(0);
  const [hits, setHits] = useState(0);
  const [round, setRound] = useState(0);
  const [floor, setFloor] = useState<TierPoints | null>(null);
  const [target, setTarget] = useState<TierPoints | null>(null);
  const [found, setFound] = useState<{ answerId: string; canonical: string; tier: TierPoints }[]>([]);
  const played = useRef<Played[]>([]);
  const exclude = useRef<string[]>([]);
  const taken = useRef<string[]>([]);
  const finished = useRef(false);
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const shake = useAnimationControls();

  const finish = useCallback(
    (score: number, label: string) => {
      if (finished.current) return;
      finished.current = true;
      onDone({ score, label, played: played.current });
    },
    [onDone],
  );

  const loadQuestion = useCallback(
    async (opts: { tier?: number; minAnswers?: number } = {}) => {
      try {
        const next = await api.practiceQuestion({ exclude: exclude.current, ...opts });
        exclude.current.push(next.id);
        taken.current = [];
        setQ(next);
        setText("");
        inputRef.current?.focus();
        return next;
      } catch {
        setMsg({ text: "Couldn't load a prompt. Check your connection.", tone: "bad" });
        return null;
      }
    },
    [],
  );

  // The submarine dives with your running total (Roulette keeps score in hits, so it stays put).
  useEffect(() => {
    if (mode !== "roulette") onDepth(points);
  }, [mode, points, onDepth]);

  // Start the run.
  useEffect(() => {
    void (async () => {
      if (mode === "sprint") {
        setTotalMs(60_000);
        await loadQuestion();
        setEndsAt(serverNow() + 60_000);
      } else if (mode === "five") {
        setTotalMs(60_000);
        await loadQuestion({ minAnswers: 60 });
        setEndsAt(serverNow() + 60_000);
      } else if (mode === "roulette") {
        const t = ROULETTE_TARGETS[Math.floor(Math.random() * ROULETTE_TARGETS.length)];
        setTarget(t);
        await loadQuestion({ tier: t });
        setEndsAt(serverNow() + ROUND_SECONDS * 1000);
      } else {
        await loadQuestion();
        setEndsAt(serverNow() + ROUND_SECONDS * 1000);
      }
    })();
  }, [mode, loadQuestion]);

  const nextRound = async (opts: { tier?: number } = {}) => {
    const n = await loadQuestion(opts);
    if (n) setEndsAt(serverNow() + ROUND_SECONDS * 1000);
  };

  const nextRoulette = async (hitsNow: number, roundNow: number) => {
    if (roundNow >= 7) return finish(hitsNow, `${hitsNow} of 7 tiers hit`);
    const t = ROULETTE_TARGETS[Math.floor(Math.random() * ROULETTE_TARGETS.length)];
    setTarget(t);
    await nextRound({ tier: t });
  };

  // The timer can fire long after this render, so read the latest values from a ref.
  const live = useRef({ q, points, hits, found, round, target });
  live.current = { q, points, hits, found, round, target };

  const onExpire = () => {
    const { q, points, hits, found, round, target } = live.current;
    if (finished.current || !q) return;
    if (mode === "sprint") return finish(points, `${hits} answer${hits === 1 ? "" : "s"} in 60 seconds`);
    if (mode === "five") return finish(points, `${found.length} of 5 answers`);
    if (mode === "ladder") {
      played.current.push({ prompt: q.prompt, canonical: null, tier: null, note: "Out of time" });
      return finish(hits, hits ? `Climbed ${hits} rung${hits === 1 ? "" : "s"} before time ran out` : "Out of time on the first rung");
    }
    // roulette
    played.current.push({ prompt: q.prompt, canonical: null, tier: null, note: `Missed (${tierInfo(target!).name})` });
    const r = round + 1;
    setRound(r);
    setMsg({ text: "Time's up! Next one…", tone: "bad" });
    void nextRoulette(hits, r);
  };

  const submit = async () => {
    const guess = text.trim();
    if (!guess || !q || busy.current || finished.current) return;
    busy.current = true;
    setText("");
    try {
      const r = await api.practiceGuess(q.id, guess, mode === "five" || mode === "roulette" ? taken.current : []);
      if (!r.accepted || !r.tier || !r.canonical || !r.answerId) {
        setMsg({ text: r.reason === "taken" ? "You already used that one" : "Not on the list. Keep trying!", tone: "bad" });
        if (!reducedMotion) void shake.start({ x: [0, -10, 8, -6, 4, 0], transition: { duration: 0.4 } });
        return;
      }
      const t = tierInfo(r.tier);
      if (mode === "sprint") {
        played.current.push({ prompt: q.prompt, canonical: r.canonical, tier: r.tier });
        setPoints((p) => p + r.points);
        setHits((h) => h + 1);
        setFlash({ id: Date.now(), tier: r.tier, text: r.canonical });
        setMsg(null);
        await loadQuestion();
      } else if (mode === "five") {
        taken.current.push(r.answerId);
        const nextFound = [...found, { answerId: r.answerId, canonical: r.canonical, tier: r.tier }];
        setFound(nextFound);
        const total = points + r.points;
        setPoints(total);
        setFlash({ id: Date.now(), tier: r.tier, text: r.canonical });
        setMsg(null);
        if (nextFound.length >= 5) {
          played.current = nextFound.map((f) => ({ prompt: q.prompt, canonical: f.canonical, tier: f.tier }));
          finish(total, "All five found");
        }
      } else if (mode === "ladder") {
        if (floor && r.tier < floor) {
          played.current.push({ prompt: q.prompt, canonical: r.canonical, tier: r.tier, note: "Too common" });
          return finish(hits, `${r.canonical} is ${t.name}, more common than your ${tierInfo(floor).name}`);
        }
        played.current.push({ prompt: q.prompt, canonical: r.canonical, tier: r.tier });
        setFloor(r.tier);
        setHits((h) => h + 1);
        setPoints((p) => p + r.points);
        setFlash({ id: Date.now(), tier: r.tier, text: r.canonical });
        setMsg({ text: `Next answer: ${t.name} or rarer`, tone: "info" });
        await nextRound();
      } else {
        taken.current.push(r.answerId);
        if (r.tier !== target) {
          setMsg({ text: `${r.canonical} is ${t.name}: too ${r.tier < target! ? "common" : "rare"}! Try again.`, tone: "bad" });
          return;
        }
        played.current.push({ prompt: q.prompt, canonical: r.canonical, tier: r.tier });
        const h = hits + 1;
        const rd = round + 1;
        setHits(h);
        setRound(rd);
        setFlash({ id: Date.now(), tier: r.tier, text: r.canonical });
        setMsg({ text: "Bullseye! 🎯", tone: "good" });
        await nextRoulette(h, rd);
      }
    } finally {
      busy.current = false;
    }
  };

  const info = SOLO_MODES[mode];
  const status =
    mode === "sprint"
      ? `${hits} answered · ${formatDepth(points * 10)}`
      : mode === "five"
        ? `${found.length}/5 · ${formatDepth(points * 10)}`
        : mode === "ladder"
          ? `Rung ${hits + 1}${floor ? ` · ${tierInfo(floor).emoji} ${tierInfo(floor).name} or rarer` : " · any tier"}`
          : `Prompt ${Math.min(round + 1, 7)} of 7 · ${hits} hit${hits === 1 ? "" : "s"}`;

  return (
    <div className="game solo-run">
      <header className="game-header">
        <button className="link-btn" onClick={() => finish(mode === "roulette" || mode === "ladder" ? hits : points, "Ended early")}>
          ✕ End run
        </button>
        <span className="game-meta">
          {info.emoji} {info.name} · {status}
        </span>
        <span />
      </header>
      {mode === "roulette" && target && (
        <div className="roulette-target" style={{ "--tier": tierInfo(target).color } as React.CSSProperties}>
          Give me a <b>{tierInfo(target).emoji} {tierInfo(target).name}</b>
        </div>
      )}
      <AnimatePresence mode="wait">
        {q && (
          <motion.h2 key={q.id} className="prompt" initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {q.prompt}
          </motion.h2>
        )}
      </AnimatePresence>
      {q && <div className="category-tag">{q.category.replace("-", " & ")}</div>}
      <motion.div animate={shake} className="input-wrap">
        <TimerRing endsAt={endsAt} totalMs={totalMs} running={!!q && endsAt > 0} onExpire={onExpire}>
          <input
            ref={inputRef}
            className="answer-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void submit())}
            placeholder="Type an answer…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={60}
            autoFocus
          />
        </TimerRing>
        <AnimatePresence>
          {flash && (
            <motion.div
              key={flash.id}
              className="solo-flash"
              style={{ "--tier": tierInfo(flash.tier).color } as React.CSSProperties}
              initial={{ opacity: 0, y: 0, scale: 0.8 }}
              animate={{ opacity: [0, 1, 1, 0], y: -50, scale: 1 }}
              transition={{ duration: 1.3 }}
              onAnimationComplete={() => setFlash(null)}
            >
              {tierInfo(flash.tier).emoji} {flash.text} +{tierInfo(flash.tier).points}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      {msg && <p className={`hint solo-msg solo-msg--${msg.tone}`}>{msg.text}</p>}
      {mode === "sprint" && (
        <div className="center">
          <button className="btn btn--ghost btn--small" onClick={() => q && (played.current.push({ prompt: q.prompt, canonical: null, tier: null, note: "Skipped" }), void loadQuestion())}>
            Skip prompt ↷
          </button>
        </div>
      )}
      {mode === "five" && (
        <div className="five-slots">
          {Array.from({ length: 5 }, (_, i) => {
            const f = found[i];
            return (
              <div key={i} className={`five-slot${f ? " five-slot--filled" : ""}`} style={f ? ({ "--tier": tierInfo(f.tier).color } as React.CSSProperties) : undefined}>
                {f ? `${tierInfo(f.tier).emoji} ${f.canonical}` : i + 1}
              </div>
            );
          })}
        </div>
      )}
      {mode === "ladder" && (
        <div className="ladder-rungs" aria-hidden>
          {[...TIERS].reverse().map((t) => (
            <span key={t.points} className={`ladder-rung${floor && t.points >= floor ? " ladder-rung--ok" : floor ? " ladder-rung--no" : ""}`} style={{ "--tier": t.color } as React.CSSProperties}>
              {t.emoji} {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
