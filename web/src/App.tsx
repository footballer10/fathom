import { MotionConfig, animate, useMotionValue } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { APP_NAME, pointsToDepth } from "@fathom/shared";
import type { Category, FinishResponse, GameMode } from "@fathom/shared";
import { DepthGauge, DepthPill } from "./components/DepthGauge";
import type { GaugeDiver } from "./components/DepthGauge";
import { EndScreen } from "./components/EndScreen";
import { Game } from "./components/Game";
import { Home } from "./components/Home";
import { Ocean } from "./components/Ocean";
import { Particles } from "./components/Particles";
import { SettingsPanel } from "./components/SettingsPanel";
import { LeaderboardsPage } from "./components/Leaderboards";
import { ArchivePage, FriendsPage } from "./components/Social";
import { UpgradeAccount, Welcome, shouldWelcome } from "./components/Welcome";
import { getNickname } from "./nickname";
import { FriendRequestPopup } from "./components/FriendRequests";
import { SuggestBox } from "./components/SuggestBox";
import { AbyssPage } from "./components/Abyss";
import { SoloModePage } from "./components/SoloModes";
import type { SoloMode } from "./components/SoloModes";
import { AdminPortal } from "./admin/AdminPortal";
import { PartyHome } from "./party/PartyHome";
import { RoomPage } from "./party/RoomPage";
import { navigate, useRoute } from "./router";
import { useSettings } from "./settings";
import { api } from "./api";
import { setAccount } from "./player";
import { refreshRewards, useMyLook } from "./rewards";
import { CelebrationLayer } from "./components/Cosmetics";
import { PearlToast, QuestsPage, ShopPage } from "./components/RewardsPages";
import { LogbookPage } from "./components/Logbook";

type Screen =
  | { name: "home" }
  | { name: "game"; mode: GameMode; category?: Category; date?: string; key: number }
  | { name: "end"; result: FinishResponse; sessionId: string };

export function App() {
  const { settings } = useSettings();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const route = useRoute();
  const [welcome, setWelcome] = useState(shouldWelcome);
  const [inBattle, setInBattle] = useState(false);
  const [partyDivers, setPartyDivers] = useState<GaugeDiver[]>([]);
  const roomCode = /^\/room\/([A-Za-z]{4})$/.exec(route)?.[1]?.toUpperCase();
  const soloMode = /^\/play\/(sprint|ladder|roulette|five)$/.exec(route)?.[1] as SoloMode | undefined;
  // One animated depth value drives the background, creatures, particles and gauge.
  const depth = useMotionValue(0);
  const look = useMyLook();

  // Pearl balance, quests and your shop look, loaded once (and refreshed after games).
  useEffect(() => void refreshRewards(false), []);

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  // Keep the cursor in the answer box. If focus wanders off (a click on empty
  // space, a toast or animation taking it), typing a letter puts it straight
  // back, and clicking nowhere in particular returns it too.
  useEffect(() => {
    const answerBox = () => document.querySelector<HTMLInputElement>("input.answer-input:not(:disabled)");
    const editable = (el: Element | null) => !!el && (el.matches("input, textarea, select, [contenteditable='true']") || !!el.closest("[role='dialog'], [role='alertdialog']"));
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (editable(document.activeElement)) return;
      answerBox()?.focus(); // the key then lands in the box
    };
    const onFocusOut = (e: FocusEvent) => {
      const from = e.target as Element | null;
      if (!from?.matches("input.answer-input") || e.relatedTarget) return;
      // Focus went nowhere (not to a button or another field): put it back.
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) answerBox()?.focus({ preventScroll: true });
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Keep "am I signed in?" in step with the server (e.g. after signing out elsewhere).
  // Players who picked a name before accounts existed are asked to make one.
  const [upgradeName, setUpgradeName] = useState<string | null>(null);
  useEffect(() => {
    api
      .account()
      .then((a) => {
        setAccount(a.username);
        const name = getNickname();
        if (!a.username && name) setUpgradeName(name);
      })
      .catch(() => {});
  }, []);

  // CSS-only animations (background creatures, waves) read this to calm down too.
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
  }, [settings.reducedMotion]);

  /** Sink (or rise) the diver to match a point total, eased over ~1.2s. */
  const diveTo = useCallback(
    (totalPoints: number) => {
      const target = pointsToDepth(totalPoints);
      if (target === depth.get()) return;
      animate(depth, target, settings.reducedMotion ? { duration: 0 } : { duration: 1.2, ease: [0.45, 0, 0.25, 1] });
    },
    [depth, settings.reducedMotion],
  );

  const play = (mode: GameMode, category?: Category, date?: string) => {
    diveTo(0);
    setScreen({ name: "game", mode, category, date, key: Date.now() });
    navigate("/");
  };

  const goHome = () => {
    diveTo(0);
    setScreen({ name: "home" });
    navigate("/");
  };

  // Leaving a party room or page brings the diver back up.
  useEffect(() => {
    if (route !== "/") diveTo(0);
  }, [route, diveTo]);

  const atHome = route === "/" && screen.name === "home";

  if (route === "/admin") return <AdminPortal />;

  const onFinished = useCallback(
    (result: FinishResponse, sessionId: string) => {
      diveTo(result.totalPoints);
      setScreen({ name: "end", result, sessionId });
    },
    [diveTo],
  );

  return (
    <MotionConfig reducedMotion={settings.reducedMotion ? "always" : "never"}>
      <Ocean key={look.theme} depth={depth} theme={look.theme} />
      <Particles depth={depth} enabled={settings.particles && !settings.reducedMotion} />
      {!inBattle && <DepthGauge depth={depth} others={roomCode ? partyDivers : []} />}

      <div className="topbar">
        {/* The one way home at the top (hidden on the home screen itself). */}
        <div className="topbar-left">
          {!atHome && (
            <button className="home-btn" onClick={goHome}>
              <span aria-hidden>🏠</span> Home
            </button>
          )}
        </div>
        {inBattle ? <span /> : <DepthPill depth={depth} />}
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>

      <main className="column">
        {roomCode ? (
          <RoomPage key={roomCode} code={roomCode} onDepth={diveTo} onBattle={setInBattle} onDivers={setPartyDivers} />
        ) : route === "/party" ? (
          <PartyHome />
        ) : route === "/friends" ? (
          <FriendsPage />
        ) : route === "/leaderboards" ? (
          <LeaderboardsPage />
        ) : route === "/abyss" ? (
          <AbyssPage reducedMotion={settings.reducedMotion} />
        ) : soloMode ? (
          <SoloModePage key={soloMode} mode={soloMode} reducedMotion={settings.reducedMotion} onDepth={diveTo} />
        ) : route === "/shop" ? (
          <ShopPage />
        ) : route === "/quests" ? (
          <QuestsPage />
        ) : route === "/logbook" ? (
          <LogbookPage />
        ) : route === "/archive" ? (
          <ArchivePage onPlay={(date) => play("archive", undefined, date)} />
        ) : null}
        {route === "/" && screen.name === "home" && <Home onPlay={play} onSuggest={() => setSuggestOpen(true)} reducedMotion={settings.reducedMotion} />}
        {route === "/" && screen.name === "game" && (
          <Game
            key={screen.key}
            mode={screen.mode}
            category={screen.category}
            date={screen.date}
            onDepth={diveTo}
            onFinished={onFinished}
            onQuit={goHome}
          />
        )}
        {route === "/" && screen.name === "end" && (
          <EndScreen
            result={screen.result}
            sessionId={screen.sessionId}
            reducedMotion={settings.reducedMotion}
            onHome={goHome}
            onPlayUnlimited={() => play("unlimited")}
          />
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSuggest={() => setSuggestOpen(true)}
      />
      {welcome && !roomCode && !upgradeName && <Welcome onDone={() => setWelcome(false)} />}
      {upgradeName && route !== "/admin" && <UpgradeAccount name={upgradeName} />}
      {!welcome && !roomCode && <FriendRequestPopup />}
      <SuggestBox open={suggestOpen} onClose={() => setSuggestOpen(false)} />
      <CelebrationLayer reducedMotion={settings.reducedMotion} />
      <PearlToast />
    </MotionConfig>
  );
}
