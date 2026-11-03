/** Player identity: a random id kept in localStorage. Signing in to an account swaps in the account's id. */
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

/**
 * Switch this device to another player (after signing in to an account).
 * The page reloads afterwards so every screen starts fresh as that player.
 */
export function switchPlayer(id: string, nickname: string | null) {
  try {
    localStorage.setItem(KEY, id);
    if (nickname) localStorage.setItem("fathom.nickname", nickname);
    else localStorage.removeItem("fathom.nickname");
    localStorage.setItem("fathom.welcomed", "1");
  } catch {
    /* private mode: the switch lasts until the tab closes */
  }
  cached = id;
}

/** Sign out: this device becomes a brand-new guest. */
export function becomeGuest() {
  const id = randomId();
  try {
    localStorage.setItem(KEY, id);
    localStorage.removeItem("fathom.nickname");
  } catch {
    /* ignore */
  }
  cached = id;
}
