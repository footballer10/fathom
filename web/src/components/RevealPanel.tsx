import { TIERS } from "@fathom/shared";
import type { RevealResponse } from "@fathom/shared";

/** The full valid-answer list for a finished question, grouped by tier, with the player's pick highlighted. */
export function RevealPanel({ reveal, compact = false }: { reveal: RevealResponse; compact?: boolean }) {
  return (
    <div className={`reveal-panel${compact ? " reveal-panel--compact" : ""}`}>
      {TIERS.map((t) => {
        const answers = reveal.answers
          .filter((a) => a.tier === t.points)
          .sort((a, b) => a.canonical.localeCompare(b.canonical));
        if (answers.length === 0) return null;
        return (
          <section key={t.points} className="reveal-group" style={{ "--tier": t.color } as React.CSSProperties}>
            <h4 className="reveal-group-title">
              <span>{t.emoji}</span> {t.name} <span className="reveal-group-pts">{t.points} pts</span>
            </h4>
            <ul className="reveal-chips">
              {answers.map((a) => (
                <li key={a.answerId} className={`chip${a.answerId === reveal.playerAnswerId ? " chip--mine" : ""}`}>
                  {a.canonical}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
