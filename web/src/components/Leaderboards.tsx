import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TIERS, formatDepth } from "@fathom/shared";
import { api } from "../api";
import type { LeaderboardBoard, LeaderboardEntry } from "../api";
import { NicknamePrompt, getNickname } from "../nickname";
import { navigate } from "../router";

const MEDALS = ["🥇", "🥈", "🥉"];

function formatValue(b: LeaderboardBoard, v: number) {
  if (b.unit === "meters") return formatDepth(v);
  if (b.unit === "rungs") return `${v} rung${v === 1 ? "" : "s"}`;
  if (b.unit === "hits") return `${v}/7`;
  if (b.unit === "tier") {
    const t = TIERS.find((x) => x.points === v);
    return t ? `${t.emoji} ${t.name}` : String(v);
  }
  if (b.unit === "percent") return `${v}%`;
  if (b.unit === "days") return `${v} day${v === 1 ? "" : "s"}`;
  return v.toLocaleString();
}

/** Rough card height, used to balance the two columns. */
const cardHeight = (b: LeaderboardBoard) => 96 + Math.max(1, b.rows.length) * 32;

/** True when the window is wide enough for two columns of boards. */
function useWide(minWidth = 700) {
  const query = `(min-width: ${minWidth}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return wide;
}

/** Global leaderboards. Only players who have set a name appear. */
export function LeaderboardsPage() {
  const [boards, setBoards] = useState<LeaderboardBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(getNickname());
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<LeaderboardEntry | null>(null);
  const wide = useWide();

  // Two columns, each card going to whichever column is shorter so far, so both
  // columns start at the top and cards are only as tall as their rows.
  const sections = useMemo(() => {
    if (!boards) return [];
    const groups: { name: string; columns: LeaderboardBoard[][] }[] = [];
    for (const name of [...new Set(boards.map((b) => b.group))]) {
      const list = boards.filter((b) => b.group === name);
      if (!wide) {
        groups.push({ name, columns: [list] });
        continue;
      }
      const cols: LeaderboardBoard[][] = [[], []];
      const h = [0, 0];
      for (const b of list) {
        const i = h[0] <= h[1] ? 0 : 1;
        cols[i].push(b);
        h[i] += cardHeight(b);
      }
      groups.push({ name, columns: cols });
    }
    return groups;
  }, [boards, wide]);
  const [section, setSection] = useState<string | null>(null);

  /** After a request, update that player's status on every board. */
  const markFriend = (code: string, friend: "friends" | "sent") =>
    setBoards(
      (bs) =>
        bs?.map((b) => ({
          ...b,
          rows: b.rows.map((r) => (r.code === code ? { ...r, friend } : r)),
        })) ?? null,
    );

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

      <p className="muted center small">Tap a player's name to send them a friend request.</p>

      {sections.length > 1 && (
        <nav className="board-tabs" aria-label="Leaderboard sections">
          {sections.map((g) => (
            <a
              key={g.name}
              href={`#board-${g.name}`}
              className={`board-tab${section === g.name ? " board-tab--on" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setSection(g.name);
                document.getElementById(`board-${g.name}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {g.name}
            </a>
          ))}
        </nav>
      )}

      {sections.map((g) => (
        <section key={g.name} id={`board-${g.name}`} className="board-section">
          <h2 className="board-section-title">{g.name}</h2>
          <div className="board-grid">
            {g.columns.map((col, c) => (
              <div key={c} className="board-col">
                {col.map((b, i) => (
                  <motion.div
                    key={b.id}
                    className="card board"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min((i * 2 + c) * 0.04, 0.4) }}
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
                            {r.you || !r.code ? (
                              <span className="board-name">
                                {r.nickname}
                                {r.you && <span className="muted small"> (you)</span>}
                              </span>
                            ) : (
                              <button
                                className="board-name board-name--btn"
                                onClick={() => setPicked(r)}
                                title={`Add ${r.nickname} as a friend`}
                              >
                                {r.nickname}
                                {r.friend === "friends" && <span className="board-tag"> 🐠</span>}
                              </button>
                            )}
                            <span className="board-value">{formatValue(b, r.value)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </motion.div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}

      <AnimatePresence>
        {picked && (
          <PlayerCard
            key={picked.code}
            player={picked}
            hasName={!!name}
            onClose={() => setPicked(null)}
            onRequested={(status) => {
              markFriend(picked.code!, status);
              setPicked({ ...picked, friend: status });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** The pop-up when you tap someone on a leaderboard: send them a friend request. */
function PlayerCard({
  player,
  hasName,
  onClose,
  onRequested,
}: {
  player: LeaderboardEntry;
  hasName: boolean;
  onClose: () => void;
  onRequested: (status: "friends" | "sent") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justBecame, setJustBecame] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestFriend(player.code!);
      if (r.status === "friends") setJustBecame(true);
      onRequested(r.status);
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
        aria-label={player.nickname}
        initial={{ scale: 0.92, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="player-card-avatar" aria-hidden>
          {player.nickname.slice(0, 1).toUpperCase()}
        </div>
        <h3>{player.nickname}</h3>
        {player.friend === "friends" ? (
          <p>{justBecame ? "They'd already asked you, so you're now friends! 🎉" : "You're friends. 🐠"} They're on your Friends board.</p>
        ) : player.friend === "sent" ? (
          <p>Friend request sent. They'll see it next time they open Fathom.</p>
        ) : !hasName ? (
          <p className="muted">Add your name at the top of this page first, so they know who's asking.</p>
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
