import { AnimatePresence, motion } from "framer-motion";
import { useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Look } from "@fathom/shared";
import { api } from "../api";
import { getNickname, getPartyName } from "../nickname";
import { PlayerName } from "./Cosmetics";

/**
 * Tap any player's name (Daily top 10, Weekly Abyss, party rooms…) to open a
 * small card with "Send friend request". One card for the whole app.
 */

interface Target {
  nickname: string;
  code: string;
  look?: Look;
}

let current: Target | null = null;
const listeners = new Set<() => void>();
function open(t: Target | null) {
  current = t;
  listeners.forEach((l) => l());
}

/** A player's name you can tap to send them a friend request (plain text for you, or with no friend code). */
export function TapName({
  name,
  code,
  look,
  you = false,
  className,
  style,
  children,
}: {
  name: string;
  code?: string | null;
  look?: Look;
  you?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  if (you || !code) {
    return (
      <span className={className} style={style}>
        {children ?? name}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`tap-name ${className ?? ""}`}
      style={style}
      title={`Add ${name} as a friend`}
      onClick={(e) => {
        e.stopPropagation();
        open({ nickname: name, code, look });
      }}
    >
      {children ?? name}
    </button>
  );
}

export function PlayerCardHost() {
  const target = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return <AnimatePresence>{target && <Card key={target.code} target={target} onClose={() => open(null)} />}</AnimatePresence>;
}

function Card({ target, onClose }: { target: Target; onClose: () => void }) {
  const [status, setStatus] = useState<"sent" | "friends" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus((await api.requestFriend(target.code, getNickname() ?? getPartyName())).status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="card modal player-card"
        role="dialog"
        aria-label={target.nickname}
        initial={{ scale: 0.92, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="player-card-avatar" aria-hidden>
          {target.nickname.slice(0, 1).toUpperCase()}
        </div>
        <h3>
          <PlayerName name={target.nickname} look={target.look} />
        </h3>
        {status === "friends" ? (
          <p>You're friends! 🐠 They're on your Friends board.</p>
        ) : status === "sent" ? (
          <p>Friend request sent. They'll see it next time they open Fathom.</p>
        ) : (
          <>
            <p className="muted">Friends show up on each other's Friends board with their Daily results.</p>
            <button className="btn btn--primary" onClick={() => void send()} disabled={busy} autoFocus>
              {busy ? "Sending…" : "➕ Send friend request"}
            </button>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}
