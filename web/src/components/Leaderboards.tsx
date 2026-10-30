import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatDepth } from "@fathom/shared";
import { api } from "../api";
import type { LeaderboardBoard } from "../api";
import { NicknamePrompt, getNickname } from "../nickname";
import { navigate } from "../router";

const MEDALS = ["🥇", "🥈", "🥉"];

function formatValue(b: LeaderboardBoard, v: number) {
  if (b.unit === "meters") return formatDepth(v);
  if (b.unit === "percent") return `${v}%`;
  if (b.unit === "days") return `${v} day${v === 1 ? "" : "s"}`;
  return v.toLocaleString();
}

/** Global leaderboards. Only players who have set a name appear. */
export function LeaderboardsPage() {
  const [boards, setBoards] = useState<LeaderboardBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(getNickname());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api
      .leaderboards()
      .then((r) => setBoards(r.boards))
      .catch((e) => setError((e as Error).message));
  }, [name]);

  return (
    <div className="leaderboards">
      <div className="page-head">
        <button className="link-btn" onClick={() => navigate("/")}>
          ← Surface
        </button>
        <h2>Global leaderboards</h2>
      </div>

      {!name || editing ? (
        <NicknamePrompt
          title={name ? "Change your name" : "Add your name to join the leaderboards"}
          onDone={(n) => {
            setName(n);
            setEditing(false);
          }}
        />
      ) : (
        <p className="muted center small">
          You appear as <b>{name}</b>.{" "}
          <button className="link-btn" onClick={() => setEditing(true)}>
            Change name
          </button>
        </p>
      )}

      {error && <p className="error-text">Couldn't load the leaderboards: {error}</p>}
      {!boards && !error && <div className="loading">Surveying the deep…</div>}

      <div className="board-grid">
        {boards?.map((b, i) => (
          <motion.div
            key={b.id}
            className="card board"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.4) }}
          >
            <h3>{b.title}</h3>
            <p className="muted small board-desc">{b.description}</p>
            {b.rows.length === 0 ? (
              <p className="muted small">No one yet. This could be you.</p>
            ) : (
              <ol className="board-rows">
                {b.rows.map((r) => (
                  <li key={`${r.rank}-${r.nickname}`} className={r.you ? "me" : ""}>
                    <span className="board-rank">{MEDALS[r.rank - 1] ?? r.rank}</span>
                    <span className="board-name">
                      {r.nickname}
                      {r.you && <span className="muted small"> (you)</span>}
                    </span>
                    <span className="board-value">{formatValue(b, r.value)}</span>
                  </li>
                ))}
              </ol>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
