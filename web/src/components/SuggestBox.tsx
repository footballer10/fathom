import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../api";
import type { SuggestionKind } from "../api";

const KINDS: { kind: SuggestionKind; label: string; hint: string }[] = [
  { kind: "answer", label: "🦐 An answer or question", hint: "Which question, and what should (or shouldn't) count?" },
  { kind: "bug", label: "🐛 Something's broken", hint: "What happened, and on which screen?" },
  { kind: "idea", label: "💡 An idea", hint: "A new mode, a feature, anything that would make it more fun." },
  { kind: "other", label: "💬 Something else", hint: "Anything at all." },
];

/** The suggestion box. Everything sent here is read and acted on in the weekly review. */
export function SuggestBox({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<SuggestionKind>("answer");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setState("idle");
    setError(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await api.suggest(kind, text.trim());
      setText("");
      setState("sent");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };

  const hint = KINDS.find((k) => k.kind === kind)!.hint;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="card modal suggest"
            role="dialog"
            aria-modal="true"
            aria-label="Suggest a fix"
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Suggest a fix</h3>
            {state === "sent" ? (
              <>
                <p>Thanks! 🐋 Every suggestion is read in the weekly review, and answer fixes go live then.</p>
                <button className="btn btn--primary" onClick={() => setState("idle")}>
                  Send another
                </button>
                <button className="btn btn--ghost" onClick={onClose} autoFocus>
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="suggest-kinds" role="radiogroup" aria-label="What is it about?">
                  {KINDS.map((k) => (
                    <button
                      key={k.kind}
                      role="radio"
                      aria-checked={kind === k.kind}
                      className={`seg-btn${kind === k.kind ? " seg-btn--on" : ""}`}
                      onClick={() => setKind(k.kind)}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <textarea
                  className="suggest-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={hint}
                  maxLength={1000}
                  rows={5}
                  autoFocus
                />
                <div className="muted small suggest-count">{text.length}/1000</div>
                {error && <p className="error-text">{error}</p>}
                <button className="btn btn--primary" disabled={text.trim().length < 3 || state === "sending"} onClick={() => void send()}>
                  {state === "sending" ? "Sending…" : "Send suggestion"}
                </button>
                <button className="btn btn--ghost" onClick={onClose}>
                  Cancel
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
