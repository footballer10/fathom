import { useState } from "react";
import { motion } from "framer-motion";
import { NicknamePrompt } from "../nickname";
import { AccountSection } from "./AccountSection";

const SEEN_KEY = "fathom.welcomed";

export function shouldWelcome(): boolean {
  try {
    return !localStorage.getItem(SEEN_KEY) && !localStorage.getItem("fathom.nickname");
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

/** First thing a new player sees: pick a name for the leaderboards (or skip). */
export function Welcome({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const finish = () => {
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
        {signingIn ? (
          <div className="card welcome-signin">
            <h3>Sign in</h3>
            <AccountSection open initial="signin" title={false} />
            <button className="link-btn" onClick={() => setSigningIn(false)}>
              I'm new here
            </button>
          </div>
        ) : (
          <>
            <NicknamePrompt title="What should we call you?" onDone={finish} />
            <p className="muted small">
              Your name shows on the global leaderboards and to friends in party games. You can change it any time in
              Settings, and make an account there to play on any device.
            </p>
            <button className="link-btn" onClick={() => setSigningIn(true)}>
              Already have an account? Sign in
            </button>
            <button className="link-btn" onClick={finish}>
              Skip for now (you won't appear on leaderboards)
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
