import { useState } from "react";
import { VARIANT_INFO, isRoomCode } from "@fathom/shared";
import { api } from "../api";
import { navigate } from "../router";

const DIVE_MODES = [
  { variant: "classic", name: "Dive", emoji: "🌊", blurb: "Up to 16 players. Rarest answers win; ties go to whoever was faster. Ends in a depth race." },
  { variant: "coop", ...VARIANT_INFO.coop },
  { variant: "shark", ...VARIANT_INFO.shark },
  { variant: "bluff", ...VARIANT_INFO.bluff },
];
const BATTLE_MODES = [
  { variant: "classic", name: "Battle", emoji: "🐡", blurb: "Up to 12 players. Pass the pufferfish: everyone watches you type, and running out of time costs a life." },
  { variant: "hotpotato", ...VARIANT_INFO.hotpotato },
  { variant: "relay", ...VARIANT_INFO.relay },
];

function ModeCard({ name, emoji, blurb, busy, onCreate }: { name: string; emoji: string; blurb: string; busy: boolean; onCreate: () => void }) {
  return (
    <div className="card mode-card variant-card">
      <div className="mode-card-head">
        <span className="mode-card-emoji" aria-hidden>
          {emoji}
        </span>
        <h3>{name}</h3>
      </div>
      <p className="muted small">{blurb}</p>
      <button className="btn btn--primary" onClick={onCreate} disabled={busy}>
        Create room
      </button>
    </div>
  );
}

export function PartyHome() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (kind: "dive" | "battle", variant: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRoom(kind, variant);
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
      <h2 className="party-section">🌊 Group Dive <span className="muted small">everyone answers the same prompt at once</span></h2>
      <div className="variant-grid variant-grid--4">
        {DIVE_MODES.map((m) => (
          <ModeCard key={m.variant} {...m} busy={busy} onCreate={() => void create("dive", m.variant)} />
        ))}
      </div>
      <h2 className="party-section">🐡 Battle <span className="muted small">take turns, no repeats</span></h2>
      <div className="variant-grid">
        {BATTLE_MODES.map((m) => (
          <ModeCard key={m.variant} {...m} busy={busy} onCreate={() => void create("battle", m.variant)} />
        ))}
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
