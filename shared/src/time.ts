import { DAILY_EPOCH_DATE, DAILY_RESET_TZ } from "./config";

/**
 * Daily-reset clock helpers. Everything goes through Intl with an IANA time
 * zone, so daylight-saving changes in DAILY_RESET_TZ are handled for us.
 */

function zonedParts(epochMs: number, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `tz` from UTC at the given instant, in ms (e.g. -6h for MDT). */
function tzOffsetMs(epochMs: number, tz: string): number {
  const p = zonedParts(epochMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** "YYYY-MM-DD" for the given instant in the reset time zone. */
export function dailyDateFor(epochMs: number, tz = DAILY_RESET_TZ): string {
  const p = zonedParts(epochMs, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Add whole days to a "YYYY-MM-DD" string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** The UTC instant of local midnight at the start of `date` in `tz`. */
export function zonedMidnight(date: string, tz = DAILY_RESET_TZ): number {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  // Two passes: the offset can differ on either side of a DST change.
  let t = naive - tzOffsetMs(naive, tz);
  t = naive - tzOffsetMs(t, tz);
  return t;
}

/** Epoch ms of the next Daily reset after `now`. */
export function nextDailyResetAt(now: number, tz = DAILY_RESET_TZ): number {
  return zonedMidnight(addDays(dailyDateFor(now, tz), 1), tz);
}

/** Daily number: `epoch` (the launch day) is #1. */
export function dailyNumberFor(date: string, epoch = DAILY_EPOCH_DATE): number {
  const [y1, m1, d1] = epoch.split("-").map(Number);
  const [y2, m2, d2] = date.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}
