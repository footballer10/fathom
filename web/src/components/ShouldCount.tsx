import { useState } from "react";

/**
 * A small, tucked-away "this should count" link for the reveal of any question.
 * Opens to show your wrong guesses (one tap each) and a box for any other
 * answer you think is missing. Reports are reviewed in the weekly update.
 */
export function ShouldCount({ guesses, onReport }: { guesses: string[]; onReport: (guess: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unique = [...new Set(guesses.map((g) => g.trim()).filter(Boolean))].slice(-5);

  const send = async (g: string) => {
    setError(null);
    try {
      await onReport(g);
      setSent((s) => [...s, g.toLowerCase()]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!open) {
    return (
      <button className="should-count-toggle" onClick={() => setOpen(true)}>
        🚩 Think an answer should count?
      </button>
    );
  }
  return (
    <div className="should-count">
      {unique.length > 0 && (
        <div className="should-count-row">
          <span className="muted small">Your guesses:</span>
          {unique.map((g) =>
            sent.includes(g.toLowerCase()) ? (
              <span key={g} className="chip chip--sent">
                ✓ "{g}" sent
              </span>
            ) : (
              <button key={g} className="chip chip--btn" onClick={() => void send(g)}>
                "{g}" should count
              </button>
            ),
          )}
        </div>
      )}
      <form
        className="should-count-row"
        onSubmit={(e) => {
          e.preventDefault();
          const g = other.trim();
          if (!g) return;
          void send(g).then(() => setOther(""));
        }}
      >
        <input className="should-count-input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Another missing answer…" maxLength={100} />
        <button className="btn btn--small" type="submit" disabled={!other.trim()}>
          Send
        </button>
      </form>
      {sent.length > 0 && <span className="muted small">Thanks! Reports are checked in the weekly update.</span>}
      {error && <span className="error-text small">{error}</span>}
    </div>
  );
}
