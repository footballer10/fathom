import { useEffect, useState } from "react";
import { api } from "../api";
import { saveNickname } from "../nickname";
import { becomeGuest, getAccount, setAccount, switchPlayer } from "../player";

export type AccountMode = "idle" | "create" | "signin" | "password";

/**
 * Sign up, sign in, change password and sign out. Used in Settings, on the
 * first-visit screen, and wherever guests are invited to join the leaderboards.
 * Signing up keeps everything played in this browser; signing in switches this
 * browser to the account. Either way the page reloads so every screen updates.
 */
export function AccountSection({
  open,
  initial = "idle",
  title = true,
  blurb = "You're playing as a guest: you get a made-up name in parties and don't appear on leaderboards. Sign up to keep your progress on any device.",
  onCancel,
  presetName = "",
  cancelLabel,
}: {
  open: boolean;
  initial?: AccountMode;
  title?: boolean;
  blurb?: string;
  /** If given, Cancel calls this instead of going back to the two buttons. */
  onCancel?: () => void;
  /** Starting username for the sign-up form (e.g. the name a player already uses). */
  presetName?: string;
  /** Text for the Cancel/Back button. */
  cancelLabel?: string;
}) {
  const [username, setUsername] = useState<string | null | undefined>(getAccount() ?? undefined);
  const [mode, setMode] = useState<AccountMode>(initial);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(initial);
    if (initial === "create" && presetName) setName(presetName);
    setMsg(null);
    api
      .account()
      .then((a) => {
        setUsername(a.username);
        setAccount(a.username);
      })
      .catch(() => setUsername((u) => u ?? null));
  }, [open, initial]);

  const reset = (m: AccountMode) => {
    setMode(m);
    setName("");
    setPw("");
    setPw2("");
    setMsg(null);
  };
  const cancel = () => (onCancel ? onCancel() : reset("idle"));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      if (pw !== pw2) throw new Error("The two passwords don't match");
      const r = await api.createAccount(name.trim(), pw);
      setAccount(r.username);
      saveNickname(r.nickname);
      try {
        localStorage.setItem("fathom.welcomed", "1");
      } catch {
        /* ignore */
      }
      window.location.reload();
    });

  const signIn = () =>
    run(async () => {
      const r = await api.signIn(name.trim(), pw);
      switchPlayer(r.playerId, r.nickname, r.username);
      window.location.reload();
    });

  const changePassword = () =>
    run(async () => {
      if (pw2 !== name) throw new Error("The two new passwords don't match");
      await api.changePassword(pw, name);
      reset("idle");
      setBusy(false);
      setMsg("Password changed.");
    });

  const signOut = () => {
    if (
      !window.confirm(
        `Sign out of ${username}? This device will go back to being a guest. Your account keeps all its progress; sign back in any time.`,
      )
    )
      return;
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
            <input
              className="account-input"
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
            />
            <input
              className="account-input"
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="account-input"
              type="password"
              autoComplete="new-password"
              placeholder="New password again"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
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
          {blurb && <p className="muted small">{blurb}</p>}
          <div className="account-actions">
            <button className="btn btn--primary" onClick={() => reset("create")}>
              Sign up
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
              ? "Your username is also your name on the leaderboards (you can change the name later). Anything you've played in this browser comes with you."
              : "Sign in with the username and password you made on any device."}
          </p>
          <input
            className="account-input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Username"
            maxLength={16}
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
            <input
              className="account-input"
              type="password"
              autoComplete="new-password"
              placeholder="Password again"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          )}
          {mode === "create" && (
            <p className="muted small">
              There's no email, so a forgotten password can't be reset. Let your browser save it, or write it down.
            </p>
          )}
          <div className="account-actions">
            <button className="btn btn--primary" type="submit" disabled={busy || !name.trim() || !pw}>
              {busy ? "…" : mode === "create" ? "Sign up" : "Sign in"}
            </button>
            <button className="btn btn--ghost" type="button" onClick={cancel}>
              {cancelLabel ?? (onCancel ? "Back" : "Cancel")}
            </button>
          </div>
        </form>
      )}
      {msg && <p className="muted small account-msg">{msg}</p>}
    </div>
  );
}
