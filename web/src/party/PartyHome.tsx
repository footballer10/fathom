import { useState } from "react";
import { isRoomCode } from "@fathom/shared";
import { api } from "../api";
import { navigate } from "../router";

export function PartyHome() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (kind: "dive" | "battle") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRoom(kind);
      navigate(`/room/${r.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const join = async () => {
    const c = code.trim().toUpperCase();
    if (!isRoomCode(c)) return setError("Room codes are 4 letters");
    const res = await fetch(`/api/rooms/${c}`).then((r) => r.json()).catch(() => ({ exists: false }));
    if (!res.exists) return setError("No room with that code");
    navigate(`/room/${c}`);
  };

  return (
    <div className="party-home">
      <h1 className="title">Party</h1>
      <p className="tagline">Play live with friends. One person creates a room and shares the code.</p>
      <div className="mode-cards mode-cards--two">
        <div className="card mode-card">
          <div className="mode-card-head">
            <h3>Dive</h3>
            <span className="muted">Everyone answers the same prompt at once</span>
          </div>
          <p className="muted small">Up to 16 players. Rarest answers win; ties go to whoever was faster. Ends in a depth race.</p>
          <button className="btn btn--primary" onClick={() => void create("dive")} disabled={busy}>
            Create Dive room
          </button>
        </div>
        <div className="card mode-card">
          <div className="mode-card-head">
            <h3>Battle</h3>
            <span className="muted">Take turns. No repeats. Last diver standing.</span>
          </div>
          <p className="muted small">Up to 12 players. Everyone watches you type. Run out of time and you lose a life.</p>
          <button className="btn btn--primary" onClick={() => void create("battle")} disabled={busy}>
            Create Battle room
          </button>
        </div>
      </div>
      <div className="card join-card">
        <h3>Join a room</h3>
        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
            placeholder="ABCD"
            aria-label="Room code"
            autoFocus
          />
          <button className="btn" type="submit">
            Join
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
