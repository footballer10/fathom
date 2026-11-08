/**
 * Pearls, quests, streak rewards and the shop.
 *
 * Players earn pearls (🫧 the game's currency) by playing: every Daily,
 * Unlimited dive, quick-mode run, party game and Weekly Abyss pays a little,
 * daily and weekly quests pay more, and days-played milestones and
 * achievements pay the most (some also unlock items you can't buy).
 *
 * Pearls buy cosmetics in the shop. Nothing in the shop changes scoring.
 *
 * This file is shared by the server (which decides what you earned and owns
 * your balance) and the website (which shows the shop and draws the items).
 */

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type Slot = "skin" | "trail" | "buddy" | "burst" | "theme" | "title" | "color";

/** What a player has equipped, one item id per slot (missing = the default). */
export type Look = Partial<Record<Slot, string>>;

export interface ShopItem {
  id: string;
  slot: Slot;
  name: string;
  description: string;
  /** Price in pearls; null means it can only be earned (see `unlock`). */
  price: number | null;
  /** How to earn an item that isn't for sale. */
  unlock?: string;
}

export interface SkinStyle {
  body: string;
  dark: string;
  glass: string;
  pattern?: "stripes" | "dots" | "teeth" | "spikes" | "flames" | "stars" | "scales" | "rivets" | "crown" | "rainbow" | "glow";
  /** Extra colour used by the pattern. */
  accent?: string;
}

export const SLOT_INFO: Record<Slot, { name: string; plural: string; emoji: string; blurb: string }> = {
  skin: { name: "Submarine", plural: "Submarines", emoji: "🚢", blurb: "Paint your sub. Everyone in your party sees it." },
  trail: { name: "Trail", plural: "Trails", emoji: "✨", blurb: "What streams out behind your sub as it dives." },
  buddy: { name: "Sidekick", plural: "Sidekicks", emoji: "🐙", blurb: "A little friend that swims next to your sub." },
  burst: { name: "Celebration", plural: "Celebrations", emoji: "🎆", blurb: "Plays when you land a Rare answer or better." },
  theme: { name: "Ocean", plural: "Oceans", emoji: "🌊", blurb: "Recolour the whole sea you dive through." },
  title: { name: "Title", plural: "Titles", emoji: "🏷️", blurb: "Shown under your name on leaderboards and in parties." },
  color: { name: "Name colour", plural: "Name colours", emoji: "🎨", blurb: "Your name's colour on leaderboards and in parties." },
};

export const SLOTS: Slot[] = ["skin", "trail", "buddy", "burst", "theme", "title", "color"];

/** The free item every player starts with in each slot. */
export const DEFAULT_LOOK: Record<Slot, string> = {
  skin: "skin.classic",
  trail: "trail.bubbles",
  buddy: "buddy.none",
  burst: "burst.sparkle",
  theme: "theme.classic",
  title: "title.none",
  color: "color.white",
};

export const SKIN_STYLES: Record<string, SkinStyle> = {
  "skin.classic": { body: "#ffd166", dark: "#c98a1b", glass: "#bdefff" },
  "skin.coral": { body: "#ff7b6b", dark: "#b23a2e", glass: "#ffe1d6" },
  "skin.kelp": { body: "#5cc97a", dark: "#2b7a41", glass: "#d9ffe4" },
  "skin.midnight": { body: "#34406b", dark: "#151b33", glass: "#8fd3ff" },
  "skin.bubblegum": { body: "#ff9ed2", dark: "#c2508f", glass: "#fff0fa" },
  "skin.tiger": { body: "#ffa53d", dark: "#7a3b00", glass: "#fff1cc", pattern: "stripes", accent: "#2b1600" },
  "skin.polka": { body: "#7fd6ff", dark: "#2a7fb0", glass: "#ffffff", pattern: "dots", accent: "#ffffff" },
  "skin.shark": { body: "#9aa9b8", dark: "#4b5967", glass: "#e9f4ff", pattern: "teeth", accent: "#ffffff" },
  "skin.puffer": { body: "#f6d86b", dark: "#9a7a17", glass: "#fffbe0", pattern: "spikes", accent: "#9a7a17" },
  "skin.hotrod": { body: "#2b2b38", dark: "#0e0e14", glass: "#ffd9a8", pattern: "flames", accent: "#ff6a2b" },
  "skin.galaxy": { body: "#3b1f6b", dark: "#1a0b36", glass: "#d9c8ff", pattern: "stars", accent: "#fff6b0" },
  "skin.mermaid": { body: "#3fc1b0", dark: "#16756a", glass: "#e0fffa", pattern: "scales", accent: "#9af0e4" },
  "skin.steampunk": { body: "#b8794a", dark: "#5c3519", glass: "#ffe7b8", pattern: "rivets", accent: "#e9c27a" },
  "skin.ghost": { body: "rgba(220, 245, 255, 0.55)", dark: "rgba(120, 180, 210, 0.9)", glass: "rgba(255, 255, 255, 0.85)" },
  "skin.gold": { body: "#ffd23f", dark: "#a8740a", glass: "#fff6c2", pattern: "rivets", accent: "#fff2a8" },
  "skin.rainbow": { body: "#ffffff", dark: "#5a4a8a", glass: "#ffffff", pattern: "rainbow" },
  // Earned only
  "skin.lantern": { body: "#1b2a3a", dark: "#0a1018", glass: "#fff3a0", pattern: "glow", accent: "#fff07a" },
  "skin.royal": { body: "#6a3fd6", dark: "#311a73", glass: "#f0e6ff", pattern: "crown", accent: "#ffd23f" },
  "skin.pearl": { body: "#f4f1ec", dark: "#a99f92", glass: "#ffffff", pattern: "glow", accent: "#ffffff" },
};

export const NAME_COLORS: Record<string, string> = {
  "color.white": "",
  "color.aqua": "#5ee6ff",
  "color.coral": "#ff8a7a",
  "color.lime": "#a6f05a",
  "color.gold": "#ffd23f",
  "color.violet": "#c49bff",
  "color.pink": "#ff9ed2",
  "color.rainbow": "rainbow",
};

export const ITEMS: ShopItem[] = [
  // Submarines
  { id: "skin.classic", slot: "skin", name: "Classic Yellow", description: "The sub you started with.", price: 0 },
  { id: "skin.coral", slot: "skin", name: "Coral Red", description: "Bright as a reef at noon.", price: 150 },
  { id: "skin.kelp", slot: "skin", name: "Kelp Green", description: "Blends right into the forest.", price: 150 },
  { id: "skin.bubblegum", slot: "skin", name: "Bubblegum", description: "Pink, proud and very visible.", price: 150 },
  { id: "skin.midnight", slot: "skin", name: "Midnight", description: "Dark hull, glowing windows.", price: 250 },
  { id: "skin.polka", slot: "skin", name: "Polka Dot", description: "Sky blue with white spots.", price: 300 },
  { id: "skin.tiger", slot: "skin", name: "Tiger Stripe", description: "Orange with bold black stripes.", price: 400 },
  { id: "skin.mermaid", slot: "skin", name: "Mermaid Scales", description: "Shimmering teal scales.", price: 500 },
  { id: "skin.shark", slot: "skin", name: "Shark Sub", description: "Grey hull with a toothy grin.", price: 600 },
  { id: "skin.puffer", slot: "skin", name: "Pufferfish", description: "Spiky. Please don't squeeze.", price: 600 },
  { id: "skin.steampunk", slot: "skin", name: "Brass Diver", description: "Copper plates and polished rivets.", price: 700 },
  { id: "skin.hotrod", slot: "skin", name: "Hot Rod", description: "Black paint with flames down the side.", price: 800 },
  { id: "skin.galaxy", slot: "skin", name: "Galaxy", description: "A starry night, underwater.", price: 900 },
  { id: "skin.ghost", slot: "skin", name: "Ghost Ship", description: "See-through hull. Spooky.", price: 1000 },
  { id: "skin.rainbow", slot: "skin", name: "Rainbow", description: "Every colour at once.", price: 1500 },
  { id: "skin.gold", slot: "skin", name: "Solid Gold", description: "For divers with pearls to spare.", price: 2500 },
  { id: "skin.lantern", slot: "skin", name: "Lantern Sub", description: "Dark hull with a glowing lure.", price: null, unlock: "Play on 14 different days" },
  { id: "skin.royal", slot: "skin", name: "Royal Sub", description: "Purple hull with a golden crown.", price: null, unlock: "Play on 100 different days" },
  { id: "skin.pearl", slot: "skin", name: "Pearl Sub", description: "Shimmering white, like a pearl.", price: null, unlock: "Earn 10,000 pearls in total" },

  // Trails
  { id: "trail.bubbles", slot: "trail", name: "Bubbles", description: "Plain old bubbles.", price: 0 },
  { id: "trail.hearts", slot: "trail", name: "Hearts", description: "A stream of little hearts.", price: 200 },
  { id: "trail.stars", slot: "trail", name: "Stars", description: "Twinkling stars.", price: 250 },
  { id: "trail.notes", slot: "trail", name: "Music Notes", description: "Diving to the beat.", price: 300 },
  { id: "trail.ink", slot: "trail", name: "Ink Cloud", description: "Puffs of squid ink.", price: 350 },
  { id: "trail.sparkle", slot: "trail", name: "Glitter", description: "Golden sparkles everywhere.", price: 450 },
  { id: "trail.rainbow", slot: "trail", name: "Rainbow", description: "A rainbow ribbon behind you.", price: 600 },
  { id: "trail.fire", slot: "trail", name: "Afterburner", description: "Somehow, fire. Underwater.", price: 800 },
  { id: "trail.flame", slot: "trail", name: "Blue Flame", description: "A cold blue flame.", price: null, unlock: "Play on 30 different days" },

  // Sidekicks
  { id: "buddy.none", slot: "buddy", name: "None", description: "Diving solo.", price: 0 },
  { id: "buddy.fish", slot: "buddy", name: "Clownfish", description: "Orange, white and loyal.", price: 300 },
  { id: "buddy.crab", slot: "buddy", name: "Crab", description: "Holds on to your hull.", price: 350 },
  { id: "buddy.jelly", slot: "buddy", name: "Jellyfish", description: "Floats along, glowing softly.", price: 450 },
  { id: "buddy.seahorse", slot: "buddy", name: "Seahorse", description: "Small, curly and brave.", price: 500 },
  { id: "buddy.octopus", slot: "buddy", name: "Octopus", description: "Eight arms of moral support.", price: 650 },
  { id: "buddy.turtle", slot: "buddy", name: "Sea Turtle", description: "In no hurry at all.", price: 750 },
  { id: "buddy.narwhal", slot: "buddy", name: "Narwhal", description: "The unicorn of the sea.", price: 1000 },
  { id: "buddy.angler", slot: "buddy", name: "Anglerfish", description: "Brings its own light.", price: null, unlock: "Play on 7 different days" },
  { id: "buddy.whale", slot: "buddy", name: "Baby Whale", description: "Gentle, huge one day.", price: null, unlock: "Play on 50 different days" },
  { id: "buddy.krill", slot: "buddy", name: "Golden Krill", description: "Proof you found the rarest answer.", price: null, unlock: "Find 10 One in a Krillion answers" },

  // Celebrations
  { id: "burst.sparkle", slot: "burst", name: "Sparkle", description: "A quick sparkle.", price: 0 },
  { id: "burst.confetti", slot: "burst", name: "Confetti", description: "A burst of paper confetti.", price: 250 },
  { id: "burst.bubbles", slot: "burst", name: "Bubble Storm", description: "Bubbles fly everywhere.", price: 300 },
  { id: "burst.hearts", slot: "burst", name: "Love It", description: "A shower of hearts.", price: 350 },
  { id: "burst.fireworks", slot: "burst", name: "Fireworks", description: "Big colourful rings.", price: 600 },
  { id: "burst.ink", slot: "burst", name: "Ink Splash", description: "A squid's dramatic exit.", price: 500 },
  { id: "burst.fish", slot: "burst", name: "School of Fish", description: "A school of fish darts past.", price: 700 },
  { id: "burst.gold", slot: "burst", name: "Treasure", description: "Gold coins spill out.", price: null, unlock: "Win 10 party games" },

  // Oceans
  { id: "theme.classic", slot: "theme", name: "Classic Blue", description: "The ocean as it comes.", price: 0 },
  { id: "theme.tropical", slot: "theme", name: "Tropical", description: "Turquoise shallows, warm and bright.", price: 400 },
  { id: "theme.sunset", slot: "theme", name: "Sunset", description: "Pink and orange light from above.", price: 600 },
  { id: "theme.kelp", slot: "theme", name: "Kelp Forest", description: "Deep green water.", price: 600 },
  { id: "theme.arctic", slot: "theme", name: "Arctic", description: "Icy pale blue under the ice.", price: 700 },
  { id: "theme.glow", slot: "theme", name: "Bioluminescent", description: "Purple and teal glowing water.", price: 1000 },
  { id: "theme.abyss", slot: "theme", name: "Trench", description: "The darkest sea, for the bravest divers.", price: null, unlock: "Reach the Abyss (4,000 m) in a Daily" },

  // Titles
  { id: "title.none", slot: "title", name: "No title", description: "Just your name.", price: 0 },
  { id: "title.deckhand", slot: "title", name: "Deckhand", description: "Everyone starts somewhere.", price: 100 },
  { id: "title.snorkeler", slot: "title", name: "Snorkeler", description: "Toes wet, eyes open.", price: 150 },
  { id: "title.wrangler", slot: "title", name: "Krill Wrangler", description: "Herds tiny shrimp for fun.", price: 250 },
  { id: "title.navigator", slot: "title", name: "Navigator", description: "Always knows the way down.", price: 300 },
  { id: "title.sonar", slot: "title", name: "Sonar Savant", description: "Hears answers others miss.", price: 400 },
  { id: "title.captain", slot: "title", name: "Captain", description: "Runs a tight ship.", price: 600 },
  { id: "title.admiral", slot: "title", name: "Admiral", description: "Commands the whole fleet.", price: 1200 },
  { id: "title.week", slot: "title", name: "Week Diver", description: "Seven days of diving.", price: null, unlock: "Play on 7 different days" },
  { id: "title.month", slot: "title", name: "Tide Keeper", description: "Thirty days of diving.", price: null, unlock: "Play on 30 different days" },
  { id: "title.legend", slot: "title", name: "Trench Legend", description: "A hundred days of diving.", price: null, unlock: "Play on 100 different days" },
  { id: "title.year", slot: "title", name: "Ocean Eternal", description: "A year's worth of diving days.", price: null, unlock: "Play on 365 different days" },
  { id: "title.hunter", slot: "title", name: "Krillion Hunter", description: "Found the rarest answer.", price: null, unlock: "Find your first One in a Krillion" },
  { id: "title.deep", slot: "title", name: "Deep Thinker", description: "Specialist knowledge, many times over.", price: null, unlock: "Land 50 Deep Cut or rarer answers" },
  { id: "title.champ", slot: "title", name: "Party Champ", description: "Rules the party.", price: null, unlock: "Win 10 party games" },
  { id: "title.abyss", slot: "title", name: "Abyss Walker", description: "Has seen the bottom.", price: null, unlock: "Reach the Abyss (4,000 m) in a Daily" },

  // Name colours
  { id: "color.white", slot: "color", name: "White", description: "The classic.", price: 0 },
  { id: "color.aqua", slot: "color", name: "Aqua", description: "Bright sea blue.", price: 150 },
  { id: "color.coral", slot: "color", name: "Coral", description: "Warm reef red.", price: 150 },
  { id: "color.lime", slot: "color", name: "Lime", description: "Zesty green.", price: 150 },
  { id: "color.violet", slot: "color", name: "Violet", description: "Deep-sea purple.", price: 250 },
  { id: "color.pink", slot: "color", name: "Pink", description: "Bubblegum pink.", price: 250 },
  { id: "color.gold", slot: "color", name: "Gold", description: "Shiny and rich.", price: 500 },
  { id: "color.rainbow", slot: "color", name: "Rainbow", description: "Your name cycles through every colour.", price: 1200 },
];

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** Free items are owned by everyone. */
export function ownsItem(owned: readonly string[], id: string): boolean {
  const item = ITEM_BY_ID.get(id);
  return !!item && (item.price === 0 || owned.includes(id));
}

/** Keep only equipped items that exist, sit in the right slot and are owned. */
export function cleanLook(look: unknown, owned: readonly string[]): Look {
  const out: Look = {};
  if (!look || typeof look !== "object") return out;
  for (const slot of SLOTS) {
    const id = (look as Record<string, unknown>)[slot];
    if (typeof id !== "string") continue;
    const item = ITEM_BY_ID.get(id);
    if (item && item.slot === slot && ownsItem(owned, id) && id !== DEFAULT_LOOK[slot]) out[slot] = id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Earning pearls
// ---------------------------------------------------------------------------

/** Pearls for finishing things. Unlimited, quick modes and party pay out for the first few each day. */
export const PEARLS = {
  daily: (points: number) => 25 + Math.round(points / 20),
  unlimited: (points: number) => 5 + Math.round(points / 50),
  quick: 8,
  party: 6,
  partyWin: 12,
  abyss: 20,
  abyssKrillion: 50,
  /** How many of each pay out per day. */
  dailyCaps: { unlimited: 10, quick: 10, party: 15 },
} as const;

/** Things quests count. `best` is the deepest single dive in points (MAX, not a sum). */
export type QuestMetric = "daily" | "unl" | "ans" | "rare" | "deep" | "k" | "quick" | "party" | "pwin" | "abyss" | "best";

export interface Quest {
  id: string;
  label: string;
  metric: QuestMetric;
  target: number;
  pearls: number;
}

const DAILY_ALWAYS: Quest = { id: "d.daily", label: "Dive today's Daily", metric: "daily", target: 1, pearls: 15 };

const DAILY_POOL: Quest[] = [
  { id: "d.unl2", label: "Finish 2 Unlimited dives", metric: "unl", target: 2, pearls: 20 },
  { id: "d.rare3", label: "Land 3 Rare or rarer answers", metric: "rare", target: 3, pearls: 20 },
  { id: "d.deep1", label: "Land a Deep Cut or rarer", metric: "deep", target: 1, pearls: 25 },
  { id: "d.ans15", label: "Answer 15 prompts", metric: "ans", target: 15, pearls: 15 },
  { id: "d.quick1", label: "Play a quick mode (Sprint, Ladder, Roulette or Five Answers)", metric: "quick", target: 1, pearls: 15 },
  { id: "d.party1", label: "Play a party game", metric: "party", target: 1, pearls: 20 },
  { id: "d.best250", label: "Reach 2,500 m in one dive", metric: "best", target: 250, pearls: 25 },
  { id: "d.rare5", label: "Land 5 Rare or rarer answers", metric: "rare", target: 5, pearls: 30 },
];

const WEEKLY_POOL: Quest[] = [
  { id: "w.daily5", label: "Dive 5 Dailies this week", metric: "daily", target: 5, pearls: 100 },
  { id: "w.k1", label: "Find a One in a Krillion", metric: "k", target: 1, pearls: 100 },
  { id: "w.rare25", label: "Land 25 Rare or rarer answers", metric: "rare", target: 25, pearls: 80 },
  { id: "w.deep8", label: "Land 8 Deep Cut or rarer answers", metric: "deep", target: 8, pearls: 90 },
  { id: "w.pwin2", label: "Win 2 party games", metric: "pwin", target: 2, pearls: 100 },
  { id: "w.abyss", label: "Take the Weekly Abyss dive", metric: "abyss", target: 1, pearls: 50 },
  { id: "w.unl8", label: "Finish 8 Unlimited dives", metric: "unl", target: 8, pearls: 80 },
  { id: "w.quick5", label: "Play 5 quick-mode runs", metric: "quick", target: 5, pearls: 70 },
  { id: "w.best400", label: "Reach 4,000 m in one dive", metric: "best", target: 400, pearls: 100 },
  { id: "w.ans100", label: "Answer 100 prompts", metric: "ans", target: 100, pearls: 80 },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick(pool: Quest[], n: number, seed: string): Quest[] {
  const sorted = [...pool].sort((a, b) => hash(seed + a.id) - hash(seed + b.id));
  // Never two quests on the same thing in one set.
  const out: Quest[] = [];
  for (const q of sorted) if (out.length < n && !out.some((o) => o.metric === q.metric)) out.push(q);
  return out;
}

/** Today's three quests: always the Daily, plus two more that change each day. */
export function dailyQuests(date: string): Quest[] {
  return [DAILY_ALWAYS, ...pick(DAILY_POOL, 2, `d${date}`)];
}

/** This week's three quests. `week` is the week's Monday, like "2026-11-02". */
export function weeklyQuests(week: string): Quest[] {
  return pick(WEEKLY_POOL, 3, `w${week}`);
}

/** Days-played milestones (any day you played any mode counts, in a row or not): pearls plus, at some, an item you can only earn. */
export const STREAK_MILESTONES: { days: number; pearls: number; items: string[] }[] = [
  { days: 3, pearls: 50, items: [] },
  { days: 7, pearls: 100, items: ["buddy.angler", "title.week"] },
  { days: 14, pearls: 200, items: ["skin.lantern"] },
  { days: 30, pearls: 400, items: ["trail.flame", "title.month"] },
  { days: 50, pearls: 600, items: ["buddy.whale"] },
  { days: 100, pearls: 1000, items: ["skin.royal", "title.legend"] },
  { days: 200, pearls: 1500, items: [] },
  { days: 365, pearls: 3000, items: ["title.year"] },
];

/** The lifetime totals achievements look at (from the leaderboard summary row). */
export interface AchievementStats {
  dailies: number;
  krillions: number;
  deepCuts: number;
  partyWins: number;
  bestDailyPoints: number;
  bestStreak: number;
  lifetimePearls: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  pearls: number;
  items: string[];
  value: (s: AchievementStats) => number;
  target: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-daily", name: "First Dive", description: "Finish your first Daily", pearls: 25, items: [], value: (s) => s.dailies, target: 1 },
  { id: "dailies-10", name: "Regular", description: "Finish 10 Dailies", pearls: 75, items: [], value: (s) => s.dailies, target: 10 },
  { id: "dailies-50", name: "Old Salt", description: "Finish 50 Dailies", pearls: 250, items: [], value: (s) => s.dailies, target: 50 },
  { id: "dailies-200", name: "Lifer", description: "Finish 200 Dailies", pearls: 800, items: [], value: (s) => s.dailies, target: 200 },
  { id: "krillion-1", name: "One in a Krillion", description: "Find your first One in a Krillion", pearls: 100, items: ["title.hunter"], value: (s) => s.krillions, target: 1 },
  { id: "krillion-10", name: "Krill Collector", description: "Find 10 One in a Krillion answers", pearls: 400, items: ["buddy.krill"], value: (s) => s.krillions, target: 10 },
  { id: "deep-50", name: "Deep Thinker", description: "Land 50 Deep Cut or rarer answers", pearls: 300, items: ["title.deep"], value: (s) => s.deepCuts, target: 50 },
  { id: "party-1", name: "Life of the Party", description: "Win a party game", pearls: 50, items: [], value: (s) => s.partyWins, target: 1 },
  { id: "party-10", name: "Party Champ", description: "Win 10 party games", pearls: 250, items: ["title.champ", "burst.gold"], value: (s) => s.partyWins, target: 10 },
  { id: "abyss-reach", name: "Abyss Walker", description: "Reach the Abyss (4,000 m) in a Daily", pearls: 200, items: ["theme.abyss", "title.abyss"], value: (s) => s.bestDailyPoints, target: 400 },
  { id: "pearls-10k", name: "Pearl Diver", description: "Earn 10,000 pearls in total", pearls: 500, items: ["skin.pearl"], value: (s) => s.lifetimePearls, target: 10_000 },
];
