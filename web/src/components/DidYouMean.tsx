import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CONFIRM_GRACE_MS } from "@fathom/shared";
import { serverNow } from "../api";

/**
 * Shown when a guess only matched after autocorrect: "Did you mean X?"
 * Enter (or Yes) accepts it; Esc (or No) keeps typing.
 *
 * `endsAt` is the question's clock (server time). If it runs out while you're
 * deciding, you still get CONFIRM_GRACE_MS to say yes (the server honours it),
 * with a countdown; after that it closes on its own.
 */
export function DidYouMean({
  guess,
  canonical,
  onYes,
  onNo,
  endsAt,
}: {
  guess: string;
  canonical: string;
  onYes: () => void;
  onNo: () => void;
  endsAt?: number;
}) {
  const askedAt = useRef(serverNow());
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onYes();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onNo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onYes, onNo]);

  // Once the clock is out, count down the grace window, then give up.
  useEffect(() => {
    if (!endsAt) return;
    const deadline = Math.max(endsAt, askedAt.current) + CONFIRM_GRACE_MS;
    const tick = () => {
      const now = serverNow();
      if (now >= deadline) return onNo();
      setLeft(now >= endsAt ? deadline - now : null);
    };
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [endsAt, onNo]);

  return (
    <motion.div
      className={`did-you-mean${left !== null ? " did-you-mean--clutch" : ""}`}
      role="alertdialog"
      aria-label={`Did you mean ${canonical}?`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <span>
        "{guess}": did you mean <b>{canonical}</b>?
      </span>
      <span className="did-you-mean-actions">
        <button className="btn btn--primary btn--small" onClick={onYes} autoFocus>
          Yes <kbd>↵</kbd>
        </button>
        <button className="btn btn--ghost btn--small" onClick={onNo}>
          No <kbd>Esc</kbd>
        </button>
      </span>
      {left !== null && (
        <span className="did-you-mean-clock" aria-live="polite">
          ⏱ Time's up, but you have {Math.ceil(left / 1000)}s to say yes
          <span className="did-you-mean-bar">
            <span style={{ width: `${Math.max(0, Math.min(100, (left / CONFIRM_GRACE_MS) * 100))}%` }} />
          </span>
        </span>
      )}
    </motion.div>
  );
}
