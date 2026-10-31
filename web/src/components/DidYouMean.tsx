import { useEffect } from "react";
import { motion } from "framer-motion";

/**
 * Shown when a guess only matched after autocorrect: "Did you mean X?"
 * Enter (or Yes) accepts it; Esc (or No) keeps typing.
 */
export function DidYouMean({ guess, canonical, onYes, onNo }: { guess: string; canonical: string; onYes: () => void; onNo: () => void }) {
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

  return (
    <motion.div className="did-you-mean" role="alertdialog" aria-label={`Did you mean ${canonical}?`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
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
    </motion.div>
  );
}
