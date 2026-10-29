import { CATEGORIES, QUESTIONS_PER_DAY, TIERS } from "../config";

/**
 * The format and rules every question writer (a normal Claude chat, or the
 * weekly scheduled task) must follow. Kept in one place so the Generate tab,
 * WEEKLY_TASK.md and the validator agree.
 */
export const QUESTION_RULES = `WHAT MAKES A GOOD PROMPT
- Easy entry: almost anyone can name at least one answer within 5 seconds.
- Big pool: at least 50 valid answers (the validator fails under 50). Aim for 80-250.
- Clear boundary: the prompt makes it obvious what counts.
- Stable facts: nothing that changes often (no current rosters, no "currently airing" shows).
- Prompt is 80 characters or less.
- EQUAL DIFFICULTY: every question should be about as hard as every other. A typical player can name several valid answers; a strong player can reach Rare or better with some thought. No difficulty ramp.
- List (nearly) every valid answer you can think of. Anything missing gets marked wrong, which is the worst experience.

RARITY TIERS (every valid answer goes in exactly one)
- [Plankton] 10 pts: the 5-10 answers most people say first
- [Too Clever] 15 pts: 2-5 "clever but predictable" picks (still valid answers)
- [Schooler] 30 pts: about 25% of answers, solid answers past the obvious ones
- [Rare] 60 pts: about 33%, uncommon but recognizable
- [Deep Cut] 85 pts: the rest, specialized or obscure but valid
- [One in a Krillion] 100 pts: EXACTLY ONE, chosen because it is fun and satisfying to find, valid without argument (not just the most obscure)
- [Not accepted] (optional): wrong answers people commonly try (near-misses), so they are blocked even when one typo away from a real answer

ALIASES
On each answer line, after the canonical answer, add common misspellings, nicknames, abbreviations and alternate names separated by " | " (examples: "Broccoli | brocoli | brocolli", "United States | USA | US | America"). Do not repeat the same alias under two different answers.

CATEGORIES (use exactly one of these): ${CATEGORIES.join(", ")}`;

export const PLAIN_TEXT_FORMAT = `# QUESTION
date: 2026-11-02
slot: 1
category: food
prompt: Name a fruit
note: Botanical edge cases (tomato, cucumber) count as Too Clever.

[One in a Krillion]
Jabuticaba | jaboticaba

[Deep Cut]
Cherimoya | custard apple
Salak | snake fruit

[Rare]
Persimmon | persimon

[Schooler]
Apricot
Cantaloupe | cantelope

[Too Clever]
Dragon fruit | pitaya | dragonfruit
Tomato

[Plankton]
Apple | apples
Banana | bananas | banan

[Not accepted]
Tomato sauce

Format rules:
- "# QUESTION" starts each question.
- Daily questions use "date:" (YYYY-MM-DD) and "slot:" (1-7). Unlimited questions use "pool: unlimited" instead of date/slot.
- category, prompt and the tier sections are required; note is optional.
- Tier headers are exactly: ${TIERS.map((t) => `[${t.name}]`).join(" ")} [Not accepted]
- Blank lines and lines starting with // are ignored.`;

export function buildGeneratePrompt(opts: {
  openDates: { date: string; openSlots: number[] }[];
  existingPrompts: string[];
  categoryUsage: Record<string, number>;
  unlimitedCount: number;
}): string {
  const days = opts.openDates.filter((d) => d.openSlots.length);
  const dailyTotal = days.reduce((n, d) => n + d.openSlots.length, 0);
  const leastUsed = Object.entries(opts.categoryUsage)
    .sort((a, b) => a[1] - b[1])
    .map(([c]) => c);
  const schedule = days.map((d, i) => `Reply ${i + 1}: ${d.date}, slots ${d.openSlots.join(", ")}`).join("\n");
  const unlimitedReplies = Math.ceil(opts.unlimitedCount / QUESTIONS_PER_DAY);

  return `You are writing questions for a free trivia game called Krillion Unlimited. Players see an open-ended prompt (like "Name a fruit") and type one valid answer; rarer answers score more.

I need ${dailyTotal} Daily questions${opts.unlimitedCount ? ` and ${opts.unlimitedCount} extra Unlimited questions` : ""}. A full set won't fit in one reply, so write ONE DAY (up to ${QUESTIONS_PER_DAY} questions) PER REPLY, then stop and wait. When I say "next", continue with the next batch until everything is done.

DAILY SCHEDULE (one reply each):
${schedule || "(No open Daily dates right now.)"}
${opts.unlimitedCount ? `\nAFTER THE DAILIES: ${opts.unlimitedCount} Unlimited questions, ${QUESTIONS_PER_DAY} per reply (${unlimitedReplies} replies). Use "pool: unlimited" instead of date/slot.\n` : ""}
Within a day, don't repeat a category. Spread categories across the week; these are the least-used categories lately, so favor them: ${leastUsed.slice(0, 8).join(", ")}.

${QUESTION_RULES}

OUTPUT FORMAT (plain text only, no commentary, no markdown code fences):
${PLAIN_TEXT_FORMAT}

Before each reply, re-check every question: missing common answers, invalid answers, tier mistakes, a weak One in a Krillion pick, and missing misspellings or aliases. Fix them before sending.

EXISTING PROMPTS (never repeat these or near-duplicates of them):
${opts.existingPrompts.map((p) => `- ${p}`).join("\n")}

Start with Reply 1 now.`;
}
