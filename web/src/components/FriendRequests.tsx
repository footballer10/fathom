import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../api";
import type { FriendRequest } from "../api";
import { onTabVisible } from "../activity";

/** Accept / decline buttons for a list of incoming friend requests. */
export function RequestList({ requests, onAnswered }: { requests: FriendRequest[]; onAnswered: (code: string, accepted: boolean) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const answer = async (r: FriendRequest, accept: boolean) => {
    setBusy(r.code);
    try {
      await api.answerRequest(r.code, accept ? "accept" : "decline");
      onAnswered(r.code, accept);
    } finally {
      setBusy(null);
    }
  };
  return (
    <ul className="request-list">
      {requests.map((r) => (
        <li key={r.code}>
          <span className="request-avatar" aria-hidden>
            {r.nickname.slice(0, 1).toUpperCase()}
          </span>
          <span className="request-name">
            <b>{r.nickname}</b>
            <span className="muted small"> wants to be friends</span>
          </span>
          <button className="btn btn--primary btn--small" disabled={busy === r.code} onClick={() => void answer(r, true)}>
            Accept
          </button>
          <button className="btn btn--ghost btn--small" disabled={busy === r.code} onClick={() => void answer(r, false)}>
            No thanks
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Don't re-check more often than this when you keep switching back to the tab. */
const RECHECK_MS = 5 * 60_000;

/**
 * Friend requests that arrived since your last visit pop up once. Checked when
 * the site opens and when you come back to the tab (at most every 5 minutes),
 * never on a timer, so a tab left open costs nothing.
 */
export function FriendRequestPopup() {
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  useEffect(() => {
    let lastCheck = 0;
    const check = () => {
      if (Date.now() - lastCheck < RECHECK_MS) return;
      lastCheck = Date.now();
      let seen: string[] = [];
      try {
        seen = JSON.parse(sessionStorage.getItem("fathom.requestsShown") ?? "[]") as string[];
      } catch {
        /* private mode: just show them */
      }
      api
        .friendRequests()
        .then((r) => setRequests(r.requests.filter((x) => !seen.includes(x.code))))
        .catch(() => {});
    };
    check();
    return onTabVisible(check);
  }, []);

  const close = () => {
    try {
      sessionStorage.setItem("fathom.requestsShown", JSON.stringify(requests.map((r) => r.code)));
    } catch {
      /* ignore */
    }
    setRequests([]);
  };

  return (
    <AnimatePresence>
      {requests.length > 0 && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div
            className="card modal"
            role="dialog"
            aria-label="Friend requests"
            initial={{ scale: 0.92, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>🐠 {requests.length === 1 ? "New friend request" : `${requests.length} new friend requests`}</h3>
            <RequestList
              requests={requests}
              onAnswered={(code) => setRequests((rs) => rs.filter((r) => r.code !== code))}
            />
            <button className="btn btn--ghost" onClick={close}>
              Decide later (they'll wait on your Friends page)
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
