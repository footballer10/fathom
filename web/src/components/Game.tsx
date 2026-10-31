import { motion, useAnimationControls } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEADLINE_GRACE_MS, QUESTION_SECONDS, tierInfo } from "@fathom/shared";
import type { Category, FinishResponse, GameMode, RevealResponse, SessionState, TierPoints } from "@fathom/shared";
import { api } from "../api";
import { useSettings } from "../settings";
import { sounds } from "../sound";
import { RevealPanel } from "./RevealPanel";
import { ShouldCount } from "./ShouldCount";
import { TierReveal } from "./TierReveal";
import { TimerRing } from "./TimerRing";

type Phase = "loading" | "question" | "reveal" | "error";

interface Outcome {
  tier: TierPoints | null;
  canonical: string | null;
  corrected: boolean;
  guess: string;
}

const sumPoints = (s: SessionState) => s.plays.reduce((n, p) => n + p.points, 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Game({
  mode,
  category,
  date,
  onDepth,
  onFinished,
  onQuit,
}: {
  mode: GameMode;
  category?: Category;
  /** Archive mode: which past Daily to replay. */
  date?: string;
  /** Total points so far; the parent sinks the diver to match. */
  onDepth: (totalPoints: number) => void;
  onFinished: (result: FinishResponse, sessionId: string) => void;
  onQuit: () => void;
}) {
  const { settings } = useSettings();
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<SessionState | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [endsAt, setEndsAt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reveal, setReveal] = useState<RevealResponse | null>(null);
  const [penaltyPops, setPenaltyPops] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /** The local clock hit zero; we're waiting for the server to confirm. */
  const [timeUp, setTimeUp] = useState(false);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;
  const advancing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const shake = useAnimationControls();
  const revealShownAt = useRef(0);
  const started = useRef(false);
  /** Wrong guesses on the current question, so a player can say "this should count". */
  const rejected = useRef<string[]>([]);

  const play = useCallback((fn: () => void) => settings.sound && fn(), [settings.sound]);

  const fail = (err: unknown) => {
    setError(err instanceof Error ? err.message : "Something went wrong");
    setErrorCode((err as { code?: string } | null)?.code ?? null);
    setPhase("error");
  };

  /** Show the result + answer list for the session's current (finished) question. */
  const showReveal = useCallback(async (s: SessionState, guess: string) => {
    const idx = s.current!.index;
    const p = s.plays.find((x) => x.index === idx);
    setOutcome({ tier: p?.tier ?? null, canonical: p?.canonical ?? null, corrected: p?.corrected ?? false, guess });
    setPhase("reveal");
    revealShownAt.current = performance.now();
    onDepth(sumPoints(s));
    setReveal(await api.reveal(s.sessionId, idx));
  }, [onDepth]);

  const applyState = useCallback(
    async (s: SessionState) => {
      setSession(s);
      onDepth(sumPoints(s));
      if (s.finished) {
        onFinished(await api.finish(s.sessionId), s.sessionId);
        return;
      }
      if (!s.current) {
        await applyState(await api.next(s.sessionId));
        return;
      }
      if (s.currentDone) {
        await showReveal(s, "");
        return;
      }
      setOutcome(null);
      setReveal(null);
      rejected.current = [];
      setText("");
      setTimeUp(false);
      setEndsAt(s.current.endsAt);
      setPhase("question");
    },
    [onDepth, onFinished, showReveal],
  );

  // Start (or resume) the session once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (mode === "archive" && date ? api.startArchive(date) : api.start(mode, category)).then(applyState).catch(fail);
  }, [mode, category, date, applyState]);

  // Autofocus the input whenever a question is live.
  useEffect(() => {
    if (phase === "question") inputRef.current?.focus();
  }, [phase, session?.current?.index]);

  const submit = async () => {
    if (!session?.current || pending || timeUp || phase !== "question") return;
    const guess = text.trim();
    if (!guess) return;
    setPending(true);
    try {
      const r = await api.guess(session.sessionId, session.current.index, guess);
      setEndsAt(r.endsAt);
      if (r.accepted) {
        play(() => sounds.ping(r.tier ?? 10));
        const s = await api.state(session.sessionId);
        setSession(s);
        await showReveal(s, guess);
      } else if (r.questionDone) {
        // Out of time (the penalty may have drained the last seconds).
        play(() => sounds.thud());
        const s = await api.state(session.sessionId);
        setSession(s);
        await showReveal(s, guess);
      } else {
        play(() => sounds.thud());
        setText("");
        rejected.current = [...rejected.current.slice(-4), guess];
        const key = Date.now();
        setPenaltyPops((p) => [...p, key]);
        setTimeout(() => setPenaltyPops((p) => p.filter((k) => k !== key)), 1100);
        if (!settings.reducedMotion) {
          void shake.start({ x: [0, -12, 10, -8, 6, -3, 0], transition: { duration: 0.42 } });
        }
      }
    } catch (err) {
      fail(err);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  };

  const onExpire = useCallback(async () => {
    if (!session) return;
    setTimeUp(true);
    play(() => sounds.thud());
    try {
      // The server allows a short grace period for lag, so wait it out before asking.
      await sleep(DEADLINE_GRACE_MS + 60);
      for (let attempt = 0; attempt < 10; attempt++) {
        if (phaseRef.current !== "question") return; // an answer landed in the grace window
        const s = await api.state(session.sessionId);
        if (s.currentDone) {
          setSession(s);
          await showReveal(s, "");
          return;
        }
        await sleep(300);
      }
    } catch (err) {
      fail(err);
    }
  }, [session, play, showReveal]);

  const isLast = !!session?.current && session.current.index === session.total - 1;

  const advance = useCallback(async () => {
    if (!session || phase !== "reveal" || advancing.current) return;
    advancing.current = true;
    setPending(true);
    play(() => sounds.bubbles(3));
    try {
      if (isLast) onFinished(await api.finish(session.sessionId), session.sessionId);
      else await applyState(await api.next(session.sessionId));
    } catch (err) {
      fail(err);
    } finally {
      advancing.current = false;
      setPending(false);
    }
  }, [session, phase, isLast, onFinished, applyState, play]);

  // Enter or Space continues after a reveal.
  useEffect(() => {
    if (phase !== "reveal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      // Ignore the tail end of the keypress that submitted the answer.
      if (performance.now() - revealShownAt.current < 450 || e.repeat) return;
      e.preventDefault();
      void advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, advance]);

  if (phase === "error" && (errorCode === "unlimited-complete" || errorCode === "unlimited-category-complete")) {
    const whole = errorCode === "unlimited-complete";
    return (
      <motion.div
        className="card center complete-card"
        initial={settings.reducedMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 18 }}
      >
        <div className="complete-whale" aria-hidden>
          🐋
        </div>
        <h2>{whole ? "You've explored the whole ocean!" : "You've cleared this reef!"}</h2>
        <p>
          {whole
            ? "You've played every single Unlimited question. That's one in a krillion."
            : `You've played every ${category ? category.replace("-", " & ") : ""} question in Unlimited.`}
        </p>
        <p className="muted">
          {whole ? "New questions arrive every week, so check back soon. The Daily and party games are always open." : "Try another category, or check back after this week's new questions arrive."}
        </p>
        <button className="btn btn--primary" onClick={onQuit}>
          Back to the surface
        </button>
      </motion.div>
    );
  }

  if (phase === "error") {
    return (
      <div className="card center">
        <p className="error-text">{error}</p>
        <button className="btn" onClick={onQuit}>
          Back to the surface
        </button>
      </div>
    );
  }

  if (phase === "loading" || !session?.current) {
    return <div className="loading">Descending…</div>;
  }

  const q = session.current;
  return (
    <div className="game">
      <header className="game-header">
        <button className="link-btn" onClick={onQuit} aria-label="Quit to home">
          ← Surface
        </button>
        <span className="game-meta">
          {session.mode === "daily" ? `Daily #${session.dailyNumber}` : session.mode === "archive" ? `Archive #${session.dailyNumber}` : "Unlimited"} · Question {q.index + 1} of{" "}
          {session.total}
        </span>
        <span className="game-progress" aria-hidden="true">
          {Array.from({ length: session.total }, (_, i) => {
            // Each finished question's dot takes the colour of the tier you got (red for a miss).
            const p = session.plays.find((x) => x.index === i);
            const done = p ?? (i === q.index && phase === "reveal" && outcome ? { tier: outcome.tier } : null);
            const color = done?.tier ? tierInfo(done.tier).color : undefined;
            return (
              <span
                key={i}
                className={`dot${i === q.index ? " dot--current" : ""}${done ? (done.tier ? " dot--hit" : " dot--miss") : ""}`}
                style={color ? ({ "--dot": color } as React.CSSProperties) : undefined}
                title={done ? (done.tier ? tierInfo(done.tier).name : "Missed") : undefined}
              />
            );
          })}
        </span>
      </header>

      <motion.h2
        key={q.index}
        className="prompt"
        initial={settings.reducedMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        {q.prompt}
      </motion.h2>
      <div className="category-tag">{q.category.replace("-", " & ")}</div>

      {phase === "question" && (
        <>
          <motion.div animate={shake} className="input-wrap">
            <TimerRing endsAt={endsAt} totalMs={QUESTION_SECONDS * 1000} running={phase === "question"} onExpire={onExpire}>
              <input
                ref={inputRef}
                className="answer-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Type an answer…"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={60}
                disabled={timeUp}
                aria-label={`Answer: ${q.prompt}`}
                autoFocus
              />
            </TimerRing>
          </motion.div>
          <p className="hint">
            <kbd>Enter ↵</kbd> to submit · wrong guesses are free, keep trying · rarer answers dive deeper
          </p>
          {penaltyPops.length > 0 && <p className="not-accepted" role="status">Not accepted</p>}
        </>
      )}

      {phase === "reveal" && outcome && (
        <div className="reveal-area">
          <TierReveal
            tier={outcome.tier}
            canonical={outcome.canonical}
            corrected={outcome.corrected}
            guess={outcome.guess}
            reducedMotion={settings.reducedMotion}
          />
          <button className="btn btn--primary continue-btn" onClick={() => void advance()} disabled={pending}>
            {isLast ? "See your dive" : "Next question"}
          </button>
          <p className="hint">
            <kbd>Enter ↵</kbd> or <kbd>Space</kbd> to continue
          </p>
          <ShouldCount key={q.index} guesses={rejected.current} onReport={(g) => api.report(session.sessionId, q.index, g)} />
          {reveal ? (
            <details className="answers-details" open>
              <summary>All {reveal.answers.length} valid answers</summary>
              <RevealPanel reveal={reveal} compact />
            </details>
          ) : (
            <div className="loading small">Loading answers…</div>
          )}
        </div>
      )}
    </div>
  );
}
