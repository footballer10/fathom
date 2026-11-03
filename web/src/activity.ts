/**
 * Is anyone actually here? Background work (reconnecting, refreshing) waits
 * while the tab is hidden or nobody has clicked, tapped or typed for 5 minutes,
 * so a tab left open costs no server requests. `whenActive` runs a callback
 * as soon as the player is back (tab visible again, or any interaction).
 */
const IDLE_MS = 5 * 60_000;

let lastInput = Date.now();
const waiting = new Set<() => void>();

function flush() {
  if (!isActive()) return;
  const fns = [...waiting];
  waiting.clear();
  for (const fn of fns) fn();
}

if (typeof window !== "undefined") {
  const onInput = () => {
    lastInput = Date.now();
    flush();
  };
  for (const ev of ["pointerdown", "keydown", "touchstart", "wheel"]) window.addEventListener(ev, onInput, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lastInput = Date.now(); // coming back to the tab counts as being here
    flush();
  });
}

export function isActive(): boolean {
  return !document.hidden && Date.now() - lastInput < IDLE_MS;
}

/** Run `fn` now if the player is here, otherwise once they're back. Returns a cancel function. */
export function whenActive(fn: () => void): () => void {
  if (isActive()) {
    fn();
    return () => {};
  }
  waiting.add(fn);
  return () => waiting.delete(fn);
}

/** Call `fn` each time the tab becomes visible again (not on load). Returns an unsubscribe function. */
export function onTabVisible(fn: () => void): () => void {
  const handler = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
