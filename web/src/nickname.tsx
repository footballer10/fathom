import { useState } from "react";
import { nicknameProblem } from "@krillion/shared";
import { api } from "./api";

const KEY = "krillion.nickname";

export function getNickname(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveNickname(name: string) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* ignore */
  }
}

/** Asks for a nickname the first time you enter party mode or the friends leaderboard. */
export function NicknamePrompt({ onDone, title = "Pick a nickname" }: { onDone: (name: string) => void; title?: string }) {
  const [name, setName] = useState(getNickname() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const problem = nicknameProblem(name);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await api.setNickname(name.trim());
    } catch (e) {
      setBusy(false);
      return setError((e as Error).message);
    }
    saveNickname(name.trim());
    onDone(name.trim());
  };

  return (
    <div className="card nickname-card">
      <h3>{title}</h3>
      <p className="muted small">This is how friends will see you.</p>
      <form
        className="join-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input className="code-input code-input--wide" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} autoFocus placeholder="Nickname" />
        <button className="btn btn--primary" type="submit" disabled={busy}>
          Continue
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
