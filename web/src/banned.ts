import { useSyncExternalStore } from "react";

/** Set when the server says this player is banned; the app then shows only the banned screen. */
let message: string | null = null;
const listeners = new Set<() => void>();

export function markBanned(text: string) {
  if (message === text) return;
  message = text;
  listeners.forEach((l) => l());
}

/** Call with any failed API response body: notices a ban. */
export function checkBanned(data: { code?: string; error?: string } | null | undefined) {
  if (data?.code === "banned") markBanned(data.error ?? "This player has been banned from Fathom.");
}

export function useBanned(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => message,
  );
}
