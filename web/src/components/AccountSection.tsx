import { useEffect, useState } from "react";
import { api } from "../api";
import { becomeGuest, switchPlayer } from "../player";

type Mode = "idle" | "create" | "signin" | "password";

/**
 * Account controls at the top of Settings. A guest can save their progress by
 * creating an account (everything played on this device goes into it), or sign
 * in to an account made somewhere else. Signed in, you can change your password
 * or sign out.
 */
export function AccountSection({ open, initial = "idle", title = true }: { open: boolean; initial?: Mode; title?: boolean }) {
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(initial);
    setMsg(null);
    api
      .account()
      .then((a) => setUsername(a.username))
      .catch(() => setUsername(null));
  }, [open, initial]);

  const reset = (m: Mode) => {
    setMode(m);
    setName("");
    setPw("");
    setPw2("");
    setMsg(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      if (pw !== pw2) throw new Error("The two passwords don't match");
      const r = await api.createAccount(name.trim(), pw);
      setUsername(r.username);
      reset("idle");
      setMsg(`Account created! Sign in as ${r.username} on any other device to play with the same progress.`);
    });

  const signIn = () =>
    run(async () => {
      const r = await api.signIn(name.trim(), pw);
      switchPlayer(r.playerId, r.nickname);
      window.location.reload();
    });

  const changePassword = () =>
    run(async () => {
      if (pw2 !== name) throw new Error("The two new passwords don't match");
      await api.changePassword(pw, name);
      reset("idle");
      setMsg("Password changed.");
    });

  const signOut = () => {
    if (!window.confirm(`Sign out of ${username}? This device will start fresh as a guest. Your account keeps all its progress; sign back in any time.`)) return;
    becomeGuest();
    window.location.reload();
  };

  if (username === undefined) return <div className="settings-account muted small">Checking your account…</div>;

  return (
    <div className="settings-account">
      {title && <span className="toggle-label">Account</span>}

      {username ? (
        mode === "password" ? (
          <form
            className="account-form"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <input className="account-input" type="password" autoComplete="current-password" placeholder="Current password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            <input className="account-input" type="password" autoComplete="new-password" placeholder="New password" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="account-input" type="password" autoComplete="new-password" placeholder="New password again" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <div className="account-actions">
              <button className="btn btn--primary" type="submit" disabled={busy || !pw || !name}>
                Change password
              </button>
              <button className="btn btn--ghost" type="button" onClick={() => reset("idle")}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="account-status">
              Signed in as <b>{username}</b>
            </p>
            <div className="account-actions">
              <button className="btn" onClick={() => reset("password")}>
                Change password
              </button>
              <button className="btn btn--ghost" onClick={signOut}>
                Sign out
              </button>
            </div>
          </>
        )
      ) : mode === "idle" ? (
        <>
          <p className="muted small">You're playing as a guest, so your progress only lives in this browser. Make an account to keep it safe and play on any device.</p>
          <div className="account-actions">
            <button className="btn btn--primary" onClick={() => reset("create")}>
              Create account
            </button>
            <button className="btn" onClick={() => reset("signin")}>
              Sign in
            </button>
          </div>
        </>
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void (mode === "create" ? create() : signIn());
          }}
        >
          <p className="muted small">
            {mode === "create"
              ? "Everything you've played in this browser goes into your new account."
              : "This browser will switch to your account. What it has played as a guest stays behind."}
          </p>
          <input
            className="account-input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Username"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            className="account-input"
            type="password"
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          {mode === "create" && (
            <input className="account-input" type="password" autoComplete="new-password" placeholder="Password again" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          )}
          {mode === "create" && <p className="muted small">There's no email, so a forgotten password can't be reset. Write it down or let your browser save it.</p>}
          <div className="account-actions">
            <button className="btn btn--primary" type="submit" disabled={busy || !name.trim() || !pw}>
              {busy ? "…" : mode === "create" ? "Create account" : "Sign in"}
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => reset("idle")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {msg && <p className="muted small account-msg">{msg}</p>}
    </div>
  );
}
