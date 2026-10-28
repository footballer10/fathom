import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface Settings {
  sound: boolean;
  reducedMotion: boolean;
  particles: boolean;
}

const KEY = "krillion.settings";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function load(): Settings {
  const defaults: Settings = { sound: true, reducedMotion: prefersReducedMotion(), particles: true };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return saved ? { ...defaults, ...saved } : defaults;
  } catch {
    return defaults;
  }
}

const Ctx = createContext<{ settings: Settings; update: (patch: Partial<Settings>) => void } | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private mode: settings just won't persist */
    }
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
  }, [settings]);

  const value = useMemo(
    () => ({ settings, update: (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })) }),
    [settings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
