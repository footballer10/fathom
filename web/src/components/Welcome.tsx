import { useState } from "react";
import { motion } from "framer-motion";
import { getPartyName } from "../nickname";
import { AccountSection, type AccountMode } from "./AccountSection";

const SEEN_KEY = "fathom.welcomed";

export function shouldWelcome(): boolean {
  try {
    return !localStorage.getItem(SEEN_KEY) && !localStorage.getItem("fathom.nickname") && !localStorage.getItem("fathom.account");
  } catch {
    return false;
  }
}

function markWelcomed() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode: they'll just see this again next time */
  }
}

/** First thing a new player sees: sign up, sign in, or carry on as a guest. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [mode, setMode] = useState<AccountMode | null>(null);
  const asGuest = () => {
    getPartyName(); // hand out the guest's party name now
    markWelcomed();
    setLeaving(true);
    onDone();
  };
  return (
    <motion.div className="welcome-backdrop" initial={{ opacity: 0 }} animate={{ opacity: leaving ? 0 : 1 }}>
      <motion.div
        className="welcome"
        initial={{ y: 30, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
      >
        <div className="welcome-whale" aria-hidden>
          🐋
        </div>
        <h2>Welcome to Fathom</h2>
        <p>Name something. The rarer your answer, the deeper you dive.</p>
        {mode ? (
          <div className="card welcome-signin">
            <h3>{mode === "create" ? "Sign up" : "Sign in"}</h3>
            <AccountSection open initial={mode} title={false} onCancel={() => setMode(null)} />
          </div>
        ) : (
          <div className="welcome-choices">
            <button className="btn btn--primary btn--big" onClick={() => setMode("create")}>
              Sign up
              <span className="welcome-choice-hint">Get on the leaderboards and play on any device</span>
            </button>
            <button className="btn btn--big" onClick={() => setMode("signin")}>
              Sign in
              <span className="welcome-choice-hint">Already have an account</span>
            </button>
            <button className="btn btn--ghost" onClick={asGuest}>
              Continue as guest
              <span className="welcome-choice-hint">You get a made-up name for parties and don't appear on leaderboards</span>
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
