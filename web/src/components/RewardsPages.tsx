import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DEFAULT_LOOK, ITEMS, ITEM_BY_ID, SLOTS, SLOT_INFO, ownsItem } from "@fathom/shared";
import type { ShopItem, Slot } from "@fathom/shared";
import { navigate } from "../router";
import { buyItem, claimReward, equipItem, readyToClaim, refreshRewards, useMyLook, usePearlGain, useRewards } from "../rewards";
import type { QuestView, RewardsStatus } from "../rewards";
import { ItemPreview, PlayerName, SubRig } from "./Cosmetics";
import { getNickname } from "../nickname";

/** The pearl icon used everywhere (drawn, not an emoji, so it looks the same on every device). */
export function Pearl({ size = 16 }: { size?: number }) {
  return (
    <svg className="pearl-icon" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <defs>
        <radialGradient id="pearl-g" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#f3ecf7" />
          <stop offset="1" stopColor="#b9a9c9" />
        </radialGradient>
      </defs>
      <circle cx="10" cy="10" r="8.5" fill="url(#pearl-g)" stroke="#8d7da0" strokeWidth="0.8" />
      <ellipse cx="7" cy="6.5" rx="2.4" ry="1.5" fill="#fff" opacity="0.9" />
    </svg>
  );
}

export function PearlCount({ n, big = false }: { n: number; big?: boolean }) {
  return (
    <span className={`pearl-count ${big ? "pearl-count--big" : ""}`}>
      <Pearl size={big ? 24 : 16} /> {n.toLocaleString("en-US")}
    </span>
  );
}

/** "+25 pearls" floating up in the corner whenever the balance grows. */
export function PearlToast() {
  const gain = usePearlGain();
  const [shown, setShown] = useState<{ amount: number; key: number } | null>(null);
  useEffect(() => {
    if (!gain) return;
    setShown(gain);
    const t = setTimeout(() => setShown((s) => (s?.key === gain.key ? null : s)), 2600);
    return () => clearTimeout(t);
  }, [gain]);
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.key}
          className="pearl-toast"
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20 }}
          role="status"
        >
          <Pearl size={20} /> +{shown.amount} pearls
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Home screen strip: balance, today's quests at a glance, and the way to the shop, quests and logbook. */
export function RewardsStrip() {
  const s = useRewards();
  useEffect(() => void refreshRewards(false), []);
  const ready = readyToClaim(s);
  const done = s ? s.daily.quests.filter((q) => q.progress >= q.target).length : 0;
  return (
    <div className="card rewards-strip">
      <div className="rewards-strip-top">
        <PearlCount n={s?.pearls ?? 0} big />
        {s && s.streak.current > 0 && <span className="streak-chip">🔥 {s.streak.current}-day streak</span>}
      </div>
      <p className="muted small">
        {s ? `Today's quests: ${done} of ${s.daily.quests.length} done.` : "Play to earn pearls, then spend them in the shop."}
        {ready > 0 && <b className="ready-note"> {ready} reward{ready === 1 ? "" : "s"} ready to collect!</b>}
      </p>
      <div className="rewards-strip-btns">
        <button className={`btn ${ready ? "btn--primary" : ""}`} onClick={() => navigate("/quests")}>
          📜 Quests{ready ? ` (${ready})` : ""}
        </button>
        <button className="btn" onClick={() => navigate("/shop")}>
          🛍️ Shop
        </button>
        <button className="btn" onClick={() => navigate("/logbook")}>
          📖 Logbook
        </button>
      </div>
    </div>
  );
}

function QuestRow({ q, onClaim, busy }: { q: QuestView; onClaim: () => void; busy: boolean }) {
  const done = q.progress >= q.target;
  return (
    <li className={`quest ${q.claimed ? "quest--claimed" : done ? "quest--done" : ""}`}>
      <div className="quest-main">
        <span className="quest-label">{q.label}</span>
        <div className="quest-bar" aria-label={`${q.progress} of ${q.target}`}>
          <span style={{ width: `${(q.progress / q.target) * 100}%` }} />
        </div>
        <span className="muted small">
          {q.metric === "best" ? `${(q.progress * 10).toLocaleString("en-US")} / ${(q.target * 10).toLocaleString("en-US")} m` : `${q.progress} / ${q.target}`}
        </span>
      </div>
      {q.claimed ? (
        <span className="quest-claimed">✓ Collected</span>
      ) : (
        <button className="btn btn--small btn--primary" disabled={!done || busy} onClick={onClaim}>
          <Pearl size={14} /> {q.pearls}
        </button>
      )}
    </li>
  );
}

function untilText(ms: number) {
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
}

function itemNames(ids: string[]) {
  return ids.map((id) => ITEM_BY_ID.get(id)?.name ?? id).join(" + ");
}

export function QuestsPage() {
  const s = useRewards();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void refreshRewards(false), []);

  const claim = async (kind: "quest" | "achievement" | "streak", id: string) => {
    setBusy(true);
    setError(null);
    try {
      await claimReward(kind, id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <div className="card center">Loading your quests…</div>;
  const nextMilestone = s.streak.milestones.find((m) => m.days > s.streak.best);
  return (
    <div className="rewards-page">
      <div className="page-head">
        <h2>📜 Quests</h2>
        <PearlCount n={s.pearls} big />
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <h3>Today</h3>
        <p className="muted small">New quests every day at midnight Mountain time.</p>
        <ul className="quest-list">
          {s.daily.quests.map((q) => (
            <QuestRow key={q.id} q={q} busy={busy} onClaim={() => claim("quest", q.id)} />
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>This week</h3>
        <p className="muted small">New ones in {untilText(s.weekly.endsAt - Date.now())}.</p>
        <ul className="quest-list">
          {s.weekly.quests.map((q) => (
            <QuestRow key={q.id} q={q} busy={busy} onClaim={() => claim("quest", q.id)} />
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>🔥 Daily streak: {s.streak.current} day{s.streak.current === 1 ? "" : "s"}</h3>
        <p className="muted small">
          {s.streak.playedToday ? "You've played today. " : s.streak.current ? "Play today's Daily to keep it going! " : "Play the Daily on back-to-back days to build a streak. "}
          Your best streak is {s.streak.best} day{s.streak.best === 1 ? "" : "s"}. Reach a milestone, then tap it to collect.
          {nextMilestone && ` Next: ${nextMilestone.days} days.`}
        </p>
        <ol className="milestones">
          {s.streak.milestones.map((m) => {
            const ready = m.reached && !m.claimed;
            return (
              <li key={m.days}>
                <button
                  className={`milestone ${m.claimed ? "milestone--claimed" : ready ? "milestone--ready" : ""}`}
                  disabled={!ready || busy}
                  onClick={() => claim("streak", String(m.days))}
                  title={ready ? "Tap to collect" : m.claimed ? "Collected" : `Reach a ${m.days}-day streak`}
                >
                  <span className="milestone-days">{m.days}</span>
                  <span className="milestone-reward">
                    <Pearl size={12} /> {m.pearls}
                    {m.items.length > 0 && <span className="milestone-items"> + {itemNames(m.items)}</span>}
                    <span className="milestone-state">{m.claimed ? "✓ Collected" : ready ? "Tap to collect!" : ""}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="card">
        <h3>🏅 Achievements</h3>
        <ul className="quest-list">
          {s.achievements.map((a) => {
            const done = a.progress >= a.target;
            return (
              <li key={a.id} className={`quest ${a.claimed ? "quest--claimed" : done ? "quest--done" : ""}`}>
                <div className="quest-main">
                  <span className="quest-label">
                    <b>{a.name}</b> · {a.description}
                  </span>
                  <div className="quest-bar">
                    <span style={{ width: `${(a.progress / a.target) * 100}%` }} />
                  </div>
                  <span className="muted small">
                    {a.id === "abyss-reach" ? `${(a.progress * 10).toLocaleString("en-US")} / 4,000 m` : `${a.progress.toLocaleString("en-US")} / ${a.target.toLocaleString("en-US")}`}
                    {a.items.length > 0 && ` · unlocks ${itemNames(a.items)}`}
                  </span>
                </div>
                {a.claimed ? (
                  <span className="quest-claimed">✓ Collected</span>
                ) : (
                  <button className="btn btn--small btn--primary" disabled={!done || busy} onClick={() => claim("achievement", a.id)}>
                    <Pearl size={14} /> {a.pearls}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {s.recent.length > 0 && (
        <div className="card">
          <h3>Recent pearls</h3>
          <ul className="pearl-history">
            {s.recent.map((r, i) => (
              <li key={i}>
                <span>{r.label}</span>
                <span className="muted small">{new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <b>+{r.pearls}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="center">
        <button className="btn btn--primary" onClick={() => navigate("/shop")}>
          🛍️ Spend pearls in the shop
        </button>
      </div>
    </div>
  );
}

function ShopCard({ item, s, equipped, busy, onBuy, onEquip }: { item: ShopItem; s: RewardsStatus; equipped: boolean; busy: boolean; onBuy: () => void; onEquip: () => void }) {
  const owned = ownsItem(s.owned, item.id);
  const short = item.price !== null && !owned ? item.price - s.pearls : 0;
  return (
    <li className={`shop-card ${equipped ? "shop-card--on" : ""} ${owned ? "" : "shop-card--locked"}`}>
      <div className="shop-preview">
        <ItemPreview item={item} />
      </div>
      <b className="shop-name">{item.name}</b>
      <span className="muted small shop-desc">{item.description}</span>
      {equipped ? (
        <span className="shop-on">✓ Using</span>
      ) : owned ? (
        <button className="btn btn--small" disabled={busy} onClick={onEquip}>
          Use
        </button>
      ) : item.price === null ? (
        <span className="shop-unlock">🔒 {item.unlock}</span>
      ) : (
        <button className="btn btn--small btn--primary" disabled={busy || short > 0} onClick={onBuy} title={short > 0 ? `${short} more pearls needed` : undefined}>
          <Pearl size={14} /> {item.price.toLocaleString("en-US")}
        </button>
      )}
    </li>
  );
}

export function ShopPage() {
  const s = useRewards();
  const look = useMyLook();
  const [slot, setSlot] = useState<Slot>("skin");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  useEffect(() => void refreshRewards(false), []);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: ok, tone: "good" });
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <div className="card center">Loading the shop…</div>;
  const items = ITEMS.filter((i) => i.slot === slot).sort((a, b) => Number(a.price === null) - Number(b.price === null) || (a.price ?? 0) - (b.price ?? 0));
  const name = getNickname() || "You";
  return (
    <div className="rewards-page">
      <div className="page-head">
        <h2>🛍️ Shop</h2>
        <PearlCount n={s.pearls} big />
      </div>

      <div className="card shop-mirror">
        <div className="shop-mirror-sub">
          <SubRig width={90} />
        </div>
        <PlayerName name={name} look={look} />
        <p className="muted small">This is how other divers see you on leaderboards and in parties.</p>
      </div>

      <div className="shop-tabs" role="tablist">
        {SLOTS.map((sl) => (
          <button key={sl} role="tab" aria-selected={slot === sl} className={`shop-tab ${slot === sl ? "shop-tab--on" : ""}`} onClick={() => setSlot(sl)}>
            {SLOT_INFO[sl].emoji} {SLOT_INFO[sl].plural}
          </button>
        ))}
      </div>
      <p className="muted small center">{SLOT_INFO[slot].blurb}</p>
      {msg && <p className={msg.tone === "good" ? "good-text center" : "error-text center"}>{msg.text}</p>}

      <ul className="shop-grid">
        {items.map((item) => (
          <ShopCard
            key={item.id}
            item={item}
            s={s}
            equipped={(look[slot] ?? DEFAULT_LOOK[slot]) === item.id}
            busy={busy}
            onBuy={() => act(async () => {
              await buyItem(item.id);
              await equipItem(item.slot, item.id);
            }, `Bought and equipped ${item.name}!`)}
            onEquip={() => act(() => equipItem(item.slot, item.id), `Now using ${item.name}.`)}
          />
        ))}
      </ul>
      <p className="muted small center">
        Earn pearls by playing: every Daily, Unlimited dive, quick mode, party game and Weekly Abyss pays, and{" "}
        <button className="link-btn" onClick={() => navigate("/quests")}>
          quests
        </button>{" "}
        pay more. Some items can only be earned through streaks and achievements.
      </p>
    </div>
  );
}
