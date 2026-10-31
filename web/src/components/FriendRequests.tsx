import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../api";
import type { FriendRequest } from "../api";

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

/** Friend requests that arrived since your last visit pop up once when you open the site. */
export function FriendRequestPopup() {
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  useEffect(() => {
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
