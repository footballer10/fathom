/**
 * A small, simple nickname filter. It catches common slurs and obscenities,
 * including basic letter swaps (sh1t, @ss). Not exhaustive; it's for friends.
 */
const BLOCKED = [
  "fuck", "shit", "cunt", "bitch", "bastard", "dick", "cock", "pussy", "asshole", "arse", "slut", "whore",
  "fag", "faggot", "nigg", "nigga", "retard", "spic", "chink", "kike", "wank", "twat", "porn", "rape",
  "nazi", "hitler", "cum", "jizz", "tits", "boob", "penis", "vagina", "anal", "dildo",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

export function isProfane(text: string): boolean {
  const flat = text
    .toLowerCase()
    .split("")
    .map((ch) => LEET[ch] ?? ch)
    .join("")
    .replace(/[^a-z]/g, "");
  return BLOCKED.some((w) => flat.includes(w));
}

/** Trim and validate a nickname. Returns an error message, or null if it's fine. */
export function nicknameProblem(name: string): string | null {
  const n = name.trim();
  if (n.length < 2) return "Nickname must be at least 2 characters";
  if (n.length > 16) return "Nickname must be 16 characters or fewer";
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(n)) return "Use letters, numbers, spaces, and . _ ' - only";
  if (isProfane(n)) return "Please pick a different nickname";
  return null;
}
