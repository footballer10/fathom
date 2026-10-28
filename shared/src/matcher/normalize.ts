/**
 * Step 1 of the matching pipeline: turn any guess or answer into a canonical
 * comparison string. Answers and guesses go through exactly the same steps,
 * so the output only has to be *consistent*, not pretty English.
 * (e.g. "cookies" → "cooky" and "cookie" → "cooky" both land on the same key.)
 */

/** Irregular plurals → singular. */
const IRREGULAR_PLURALS: Record<string, string> = {
  geese: "goose",
  mice: "mouse",
  lice: "louse",
  teeth: "tooth",
  feet: "foot",
  children: "child",
  men: "man",
  women: "woman",
  people: "person",
  oxen: "ox",
  octopi: "octopus",
  cacti: "cactus",
  fungi: "fungus",
  knives: "knife",
  wives: "wife",
  lives: "life",
  leaves: "leaf",
  wolves: "wolf",
  loaves: "loaf",
  halves: "half",
  shelves: "shelf",
  calves: "calf",
  scarves: "scarf",
  thieves: "thief",
  potatoes: "potato",
  tomatoes: "tomato",
  heroes: "hero",
  mangoes: "mango",
  echoes: "echo",
  volcanoes: "volcano",
  mosquitoes: "mosquito",
  buffaloes: "buffalo",
  torpedoes: "torpedo",
  buses: "bus",
  gases: "gas",
  dominoes: "domino",
};

/** Words that look plural but must not be singularized. */
const INVARIANT = new Set([
  "asparagus",
  "bus",
  "gas",
  "news",
  "series",
  "species",
  "chess",
  "hummus",
  "couscous",
  "lens",
  "molasses",
  "mathematics",
  "physics",
  "athletics",
  "gymnastics",
  "aerobics",
  "economics",
  "politics",
  "billiards",
  "darts",
  "checkers",
  "pants",
  "scissors",
  "jeans",
  "shorts",
  "tongs",
  "pliers",
  "binoculars",
  "texas",
  "kansas",
  "arkansas",
  "illinois",
  "mars",
  "venus",
  "paris",
  "swiss",
  "wales",
  "barbados",
  "bahamas",
  "comoros",
  "seychelles",
  "mauritius",
  "maldives",
  "philippines",
  "netherlands",
  "honduras",
  "cyprus",
  "brussels",
  "sheep",
  "deer",
  "fish",
  "moose",
]);

/** US/UK spelling pairs, per word. Both sides are mapped to the US form. */
const SPELLING: Record<string, string> = {
  colour: "color",
  grey: "gray",
  favourite: "favorite",
  flavour: "flavor",
  harbour: "harbor",
  honour: "honor",
  humour: "humor",
  neighbour: "neighbor",
  armour: "armor",
  labour: "labor",
  theatre: "theater",
  centre: "center",
  metre: "meter",
  litre: "liter",
  fibre: "fiber",
  aluminium: "aluminum",
  sulphur: "sulfur",
  caesium: "cesium",
  jewellery: "jewelry",
  tyre: "tire",
  plough: "plow",
  programme: "program",
  moustache: "mustache",
  yoghurt: "yogurt",
  yoghourt: "yogurt",
  doughnut: "donut",
  aeroplane: "airplane",
  pyjama: "pajama",
  catalogue: "catalog",
  dialogue: "dialog",
  mould: "mold",
  draught: "draft",
  cheque: "check",
  kerb: "curb",
  storey: "story",
  manoeuvre: "maneuver",
  paediatrician: "pediatrician",
  orthopaedic: "orthopedic",
  anaesthetist: "anesthetist",
  oesophagus: "esophagus",
  haemoglobin: "hemoglobin",
  foetus: "fetus",
};

/** Singularize one (already lowercased, punctuation-free) word. */
export function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (INVARIANT.has(word)) return word;
  const irregular = IRREGULAR_PLURALS[word];
  if (irregular) return irregular;
  // "berries" → "berry"; and fold a trailing "ie" into "y" so "cookie"/"cookies" agree.
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("ie") && word.length > 4) return word.slice(0, -2) + "y";
  // "peaches", "dishes", "boxes", "glasses", "quizzes"
  if (/(ch|sh|x|ss|zz)es$/.test(word)) return word.slice(0, -2);
  // ...and fold "quiche"/"headache" onto the same key as "quich"/"headach" from the rule above.
  if (word.endsWith("che") && word.length > 4) return word.slice(0, -1);
  // Words ending in ss/us/is/ics are rarely plurals ("cactus", "iris", "physics").
  if (/(ss|us|is|ics)$/.test(word)) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Map UK spellings (and -ise/-ize variants) onto one form. */
export function unifySpelling(word: string): string {
  const mapped = SPELLING[word];
  if (mapped) return mapped;
  if (word.length > 5) {
    // organise/organize, organisation/organization, analyse/analyze
    if (word.endsWith("isation")) return word.slice(0, -7) + "ization";
    if (word.endsWith("ise")) return word.slice(0, -3) + "ize";
    if (word.endsWith("yse")) return word.slice(0, -3) + "yze";
  }
  return word;
}

const LEADING_ARTICLE = /^(the|a|an) /;

/**
 * Normalize a guess or answer to its comparison form (words separated by single spaces).
 * Steps: NFKD + strip diacritics → lowercase → & → and → drop punctuation
 * (hyphens become spaces) → collapse spaces → drop leading article →
 * singularize each word → unify US/UK spelling.
 */
export function normalize(input: string): string {
  let s = input.normalize("NFKD").replace(/\p{M}+/gu, "");
  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  // Hyphens, slashes and underscores separate words; other punctuation just disappears.
  s = s.replace(/[-‐‑–—_/]+/g, " ");
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, "");
  s = s.replace(/\s+/g, " ").trim();
  // Only drop the article when something is left after it ("A" alone stays "a").
  if (LEADING_ARTICLE.test(s)) s = s.replace(LEADING_ARTICLE, "");
  if (!s) return "";
  return s
    .split(" ")
    .map((w) => unifySpelling(singularize(w)))
    .join(" ");
}

/** The space-free key used for lookups, so "ice cream" = "icecream" = "ice-cream". */
export function compact(normalized: string): string {
  return normalized.replace(/ /g, "");
}
