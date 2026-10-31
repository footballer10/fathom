import { useEffect, useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { formatDepth, tierInfo } from "@fathom/shared";
import { api, serverNow } from "../api";
import type { AbyssStatus } from "../api";
import { getNickname } from "../nickname";
import { navigate } from "../router";
import { TimerRing } from "./TimerRing";

const MEDALS = ["🥇", "🥈", "🥉"];

function untilText(ms: number) {
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.max(0, Math.floor((ms % 3_600_000) / 60_000))}m`;
}

/** The Weekly Abyss: one very deep prompt, one 45-second dive a week, scored on your rarest answer. */
export function AbyssPage({ reducedMotion }: { reducedMotion: boolean }) {
  const [status, setStatus] = useState<AbyssStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const shake = useAnimationControls();

  const load = () =>
    api
      .abyss()
      .then((s) => {
        setStatus(s);
        setTimeUp(!!s.attempt?.done);
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => void load(), []);

  const start = async () => {
    try {
      const r = await api.abyssStart();
      setStatus((s) => (s ? { ...s, prompt: r.prompt, attempt: r.attempt } : s));
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    const guess = text.trim();
    if (!guess || timeUp) return;
    setText("");
    try {
      const r = await api.abyssGuess(guess);
      if (r.accepted && r.tier && r.canonical) {
        setMsg(null);
        setStatus((s) => {
          if (!s?.attempt) return s;
          const answers = [...s.attempt.answers, { answerId: r.canonical!, canonical: r.canonical!, tier: r.tier! }];
          const best = !s.attempt.best || r.tier! > s.attempt.best.tier ? { tier: r.tier!, canonical: r.canonical! } : s.attempt.best;
          return { ...s, attempt: { ...s.attempt, answers, best } };
        });
      } else {
        setMsg(r.reason === "taken" ? "You already found that one" : "Not on the list. Keep going!");
        if (!reducedMotion) void shake.start({ x: [0, -10, 8, -6, 4, 0], transition: { duration: 0.4 } });
      }
    } catch (e) {
      setMsg((e as Error).message);
      setTimeUp(true);
    }
  };

  const a = status?.attempt;
  const playing = !!a && !timeUp;

  return (
    <div className="abyss">
      <div className="page-head">
        <button className="link-btn" onClick={() => navigate("/")}>
          ← Surface
        </button>
        <h2>🕳️ Weekly Abyss</h2>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!status && !error && <div className="loading">Lowering the bathysphere…</div>}

      {status && !a && (
        <div className="card abyss-intro">
          <p>
            One very deep prompt for everyone this week. You get <b>one dive</b> of {status.seconds} seconds: name as many answers as you can, and your{" "}
            <b>rarest answer</b> is your score.
          </p>
          <p className="muted small">
            This week's category: <b>{status.category.replace("-", " & ")}</b>. The prompt stays hidden until you start. New Abyss in {untilText(status.weekEndsAt - Date.now())}.
          </p>
          {!getNickname() && <p className="muted small">Add a name in Settings first if you want to appear on the Abyss board.</p>}
          <button className="btn btn--primary big-btn" onClick={() => void start()}>
            Start my dive
          </button>
        </div>
      )}

      {status && a && status.prompt && (
        <>
          <h2 className="prompt">{status.prompt}</h2>
          {playing ? (
            <motion.div animate={shake} className="input-wrap">
              <TimerRing endsAt={a.endsAt} totalMs={status.seconds * 1000} running={playing} onExpire={() => (setTimeUp(true), setTimeout(() => void load(), 1800))}>
                <input
                  ref={inputRef}
                  className="answer-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void submit())}
                  placeholder="Go deep…"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={60}
                  autoFocus
                />
              </TimerRing>
            </motion.div>
          ) : (
            <motion.div className="card end-hero" initial={reducedMotion ? false : { scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <div className="muted small">Your Abyss dive this week</div>
              {a.best ? (
                <>
                  <div className="end-depth" style={{ color: tierInfo(a.best.tier).color }}>
                    {tierInfo(a.best.tier).emoji} {a.best.canonical}
                  </div>
                  <div>
                    {tierInfo(a.best.tier).name} · {formatDepth(a.best.tier * 10)}
                  </div>
                </>
              ) : (
                <div className="end-depth">No answers this time</div>
              )}
              <div className="muted small">Next Abyss in {untilText(status.weekEndsAt - serverNow())}</div>
            </motion.div>
          )}
          {msg && playing && <p className="hint">{msg}</p>}
          {a.answers.length > 0 && (
            <ul className="reveal-chips abyss-found">
              {a.answers.map((x, i) => (
                <li key={i} className={`chip${a.best?.canonical === x.canonical ? " chip--best" : ""}`} style={{ "--tier": tierInfo(x.tier).color } as React.CSSProperties}>
                  {tierInfo(x.tier).emoji} {x.canonical}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {status && (!a || timeUp) && (
        <div className="card">
          <h3>This week's deepest</h3>
          <p className="muted small">
            {status.board.divers} diver{status.board.divers === 1 ? "" : "s"} so far. Ranked by rarest answer, then by who found it fastest.
          </p>
          {status.board.rows.length === 0 ? (
            <p className="muted small">No one yet. This could be you.</p>
          ) : (
            <ol className="board-rows">
              {status.board.rows.map((r) => (
                <li key={r.rank} className={r.you ? "me" : ""}>
                  <span className="board-rank">{MEDALS[r.rank - 1] ?? r.rank}</span>
                  <span className="board-name">
                    {r.nickname}
                    {r.you && <span className="muted small"> (you)</span>}
                  </span>
                  <span className="board-value" style={{ color: tierInfo(r.tier).color }}>
                    {tierInfo(r.tier).emoji} {r.answer}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
