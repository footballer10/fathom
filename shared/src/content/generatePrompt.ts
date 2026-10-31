import { CATEGORIES, QUESTIONS_PER_DAY, TIERS } from "../config";

/**
 * The format and rules every question writer (a normal Claude chat, or the
 * weekly scheduled task) must follow. Kept in one place so the Generate tab,
 * WEEKLY_TASK.md and the validator agree.
 */
export const QUESTION_RULES = `THE MOST IMPORTANT RULE: A COMPLETE, CLOSED LIST
Every valid answer must be in the list. A player who types a correct answer and gets marked wrong is the worst thing that can happen in this game.
- Only write a prompt if you can list EVERY valid answer, not just the well-known ones.
- If the honest set of answers is too big to list completely (any US city, any bird, any word, any song, any job, anything you'd find in a kitchen), add a constraint that closes it to a fixed, checkable list. Examples:
  - "Name a US city" -> "Name a US state capital" (exactly 50)
  - "Name a city in Europe" -> "Name a national capital city" (about 195)
  - "Name a dog" -> "Name a dog breed recognized by the American Kennel Club"
  - "Name a song" -> "Name a Beatles song" (a fixed catalog)
  - "Name a word that means big" -> keep it only if you can cover every common synonym, slang included
- Good constraints point to an official or well-documented list: a ranking, a membership, an award, a roster that no longer changes, a named set (the 88 constellations, the 118 elements, the 50 states).
- Bad constraints are vague ("a famous...", "a popular...") because nobody can agree where the list ends.
- After writing the list, ask: "Could a smart player type something true that isn't here?" If yes, add it, or tighten the prompt until the answer is no.
- Completeness beats everything else, including list size. Never trim valid answers to hit a target number. A closed list of 400 answers is far better than a tidy list of 150 that rejects a correct answer.
- The noun the prompt asks for is optional automatically: for "Name a type of cheese", typing "blue" matches "Blue cheese" and "cheddar cheese" matches "Cheddar". You don't need aliases for that, but do add aliases for other words people leave off or add.
- Cover how people actually type: common misspellings, plurals, abbreviations, nicknames, surnames on their own for famous people, and names with and without "The". Add these as aliases.
- Completeness check for every question: once the list is written, brainstorm at least 20 more true answers a well-read player might type, check each one against the list, and add any that are missing. Repeat until a round of 20 turns up nothing new.

AUDIENCE: HIGH SCHOOL STUDENTS
The players are mostly US high schoolers (ages 14-18). Every prompt must be one a typical high schooler can answer several ways from everyday life, school, sports, games, movies, music they listen to, or the internet.
- Skip topics mostly known to older adults: song catalogs of older artists (Elvis, the Rolling Stones, Billy Joel, Madonna and so on), government offices beyond presidents (Supreme Court justices, Secretaries of State, Speakers of the House, prime ministers), popes, awards lists (Grammy Best New Artist, Time Person of the Year, the Heisman), and specialist knowledge like livestock or rabbit breeds and grass varieties.
- Nobody should ever blank. Every typical high schooler, including ones who don't follow that topic, must be able to think of at least one answer. Players don't need to be experts, but no one should be completely stuck.
- So no prompts about the characters, episodes, songs or details of one specific TV show, movie series, book series, video game or band, unless it is famous enough that nearly everyone knows at least one answer (SpongeBob, Harry Potter, Star Wars, Toy Story, Mario, Pokémon level). "Name a character from Friends", "Name a Stranger Things character", "Name an Avatar: The Last Airbender character" and "Name a Mario Kart track" are out.
- Test it: would every student in a high school class name at least one answer, and most of them several, in a minute? If not, pick a different prompt.

WHAT MAKES A GOOD PROMPT
- Easy entry: almost anyone can name at least one answer within 5 seconds.
- Big pool: at least 50 valid answers (the validator fails under 50). 80-250 is typical, but a closed set can be much bigger; never leave out a valid answer to stay under 250.
- Clear boundary: the prompt makes it obvious what counts, and the set of valid answers is closed (see the rule above).
- Stable facts: nothing that changes often (no current rosters, no "currently airing" shows).
- Prompt is 80 characters or less.
- No examples in the prompt: never add "(like …)", "e.g." or "such as". An example gives away an answer and steers everyone to it. Scope notes that keep it fair are fine, like "(released through 2025)".
- EQUAL DIFFICULTY: every question should be about as hard as every other. A typical player can name several valid answers; a strong player can reach Rare or better with some thought. No difficulty ramp.
- List every valid answer. Anything missing gets marked wrong, which is the worst experience.

RARITY TIERS (every valid answer goes in exactly one)
Tiers follow how common each answer is, with a fixed distribution. Rank every valid answer from "almost everyone says this" to "only an expert knows this", then split:
- [Plankton] 10 pts: the top 5% (3-7 answers), the ones almost everyone says first
- [Too Clever] 15 pts: 2-5 "clever but predictable" picks (still valid answers), set aside before ranking
- [Schooler] 30 pts: the next 15%, very common answers most people know (for kitchen utensils: fork, spoon, ladle, whisk)
- [Rare] 60 pts: the next 30%, answers a typical player knows but doesn't say first
- [Deep Cut] 85 pts: the remaining half, specialized or obscure but valid
Never put an everyday, obvious answer in Rare or Deep Cut.
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

  return `You are writing questions for a free trivia game called Fathom. Players see an open-ended prompt (like "Name a fruit") and type one valid answer; rarer answers score more.

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
