import { MotionConfig, animate, useMotionValue } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { APP_NAME, pointsToDepth } from "@fathom/shared";
import type { Category, FinishResponse, GameMode } from "@fathom/shared";
import { DepthGauge, DepthPill } from "./components/DepthGauge";
import { EndScreen } from "./components/EndScreen";
import { Game } from "./components/Game";
import { Home } from "./components/Home";
import { Ocean } from "./components/Ocean";
import { Particles } from "./components/Particles";
import { SettingsPanel } from "./components/SettingsPanel";
import { LeaderboardsPage } from "./components/Leaderboards";
import { ArchivePage, FriendsPage } from "./components/Social";
import { Welcome, shouldWelcome } from "./components/Welcome";
import { FriendRequestPopup } from "./components/FriendRequests";
import { SuggestBox } from "./components/SuggestBox";
import { AdminPortal } from "./admin/AdminPortal";
import { PartyHome } from "./party/PartyHome";
import { RoomPage } from "./party/RoomPage";
import { navigate, useRoute } from "./router";
import { useSettings } from "./settings";

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
  const roomCode = /^\/room\/([A-Za-z]{4})$/.exec(route)?.[1]?.toUpperCase();
  // One animated depth value drives the background, creatures, particles and gauge.
  const depth = useMotionValue(0);

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

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
      <Ocean depth={depth} />
      <Particles depth={depth} enabled={settings.particles && !settings.reducedMotion} />
      {!inBattle && <DepthGauge depth={depth} />}

      <div className="topbar">
        <div className="topbar-left">
          <button className="brand" onClick={goHome}>
            {APP_NAME}
          </button>
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
          <RoomPage key={roomCode} code={roomCode} onDepth={diveTo} onBattle={setInBattle} />
        ) : route === "/party" ? (
          <PartyHome />
        ) : route === "/friends" ? (
          <FriendsPage />
        ) : route === "/leaderboards" ? (
          <LeaderboardsPage />
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
        onHome={
          atHome
            ? undefined
            : () => {
                setSettingsOpen(false);
                goHome();
              }
        }
      />
      {welcome && !roomCode && <Welcome onDone={() => setWelcome(false)} />}
      {!welcome && !roomCode && <FriendRequestPopup />}
      <SuggestBox open={suggestOpen} onClose={() => setSuggestOpen(false)} />
    </MotionConfig>
  );
}
