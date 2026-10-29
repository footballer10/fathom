/** Anonymous player identity: a random UUID kept in localStorage (no accounts). */
const KEY = "fathom.playerId";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "p-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let cached: string | null = null;

export function getPlayerId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = randomId();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached ??= randomId();
  }
  return cached;
}
