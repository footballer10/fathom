import { describe, expect, it } from "vitest";
import { buildIndex, damerauLevenshtein, matchGuess, normalize } from "../src";
import type { QuestionData } from "../src";

const fruit: QuestionData = {
  id: "t-fruit",
  prompt: "Name a fruit",
  category: "food",
  answers: [
    { text: "Banana", aliases: ["banan"], tier: 10 },
    { text: "Apple", tier: 10 },
    { text: "Strawberry", tier: 10 },
    { text: "Dragon fruit", aliases: ["pitaya", "pitahaya"], tier: 15 },
    { text: "Persimmon", aliases: ["persimon"], tier: 60 },
    { text: "Pineapple", tier: 10 },
    { text: "Passion fruit", aliases: ["maracuya"], tier: 30 },
    { text: "Blackberry", tier: 30 },
    { text: "Cherry", tier: 10 },
    { text: "Peach", tier: 10 },
    { text: "Jabuticaba", tier: 100 },
  ],
  nearMisses: ["tomato sauce", "fruit salad"],
};

const countries: QuestionData = {
  id: "t-world",
  prompt: "Name a country",
  category: "geography",
  answers: [
    { text: "Austria", tier: 30 },
    { text: "Australia", tier: 10 },
    { text: "Iran", tier: 30 },
    { text: "Iraq", tier: 30 },
    { text: "United States", aliases: ["USA", "US", "America"], tier: 10 },
    { text: "Democratic Republic of the Congo", aliases: ["DRC", "Congo-Kinshasa"], tier: 60 },
    { text: "Côte d'Ivoire", aliases: ["Ivory Coast"], tier: 60 },
    { text: "Bosnia and Herzegovina", aliases: ["Bosnia"], tier: 60 },
    { text: "Bhutan", tier: 100 },
  ],
};

const eu: QuestionData = {
  id: "t-eu",
  prompt: "Name a country in the European Union",
  category: "geography",
  answers: [
    { text: "France", tier: 10 },
    { text: "Germany", tier: 10 },
    { text: "Sweden", tier: 30 },
    { text: "Netherlands", aliases: ["Holland"], tier: 30 },
    { text: "Slovenia", tier: 60 },
    { text: "Slovakia", tier: 60 },
    { text: "Luxembourg", tier: 85 },
    { text: "Malta", tier: 100 },
  ],
  nearMisses: ["Switzerland", "Norway", "United Kingdom", "Swedenland"],
};

const desserts: QuestionData = {
  id: "t-dessert",
  prompt: "Name a dessert",
  category: "food",
  answers: [
    { text: "Crème brûlée", tier: 30 },
    { text: "Ice cream", tier: 10 },
    { text: "Apple pie", tier: 10 },
    { text: "Chocolate chip cookies", tier: 10 },
    { text: "Rock & roll cake", tier: 85 },
    { text: "Baked Alaska", tier: 100 },
    { text: "Brownie", tier: 10 },
  ],
};

const animals: QuestionData = {
  id: "t-animal",
  prompt: "Name a farm animal",
  category: "animals",
  answers: [
    { text: "Goose", tier: 30 },
    { text: "Mouse", tier: 60 },
    { text: "Ox", tier: 60 },
    { text: "Sheep", tier: 10 },
    { text: "Pony", tier: 30 },
    { text: "Alpaca", tier: 85 },
    { text: "Guinea fowl", tier: 100 },
  ],
};

const veg: QuestionData = {
  id: "t-veg",
  prompt: "Name a vegetable",
  category: "food",
  answers: [
    { text: "Asparagus", tier: 30 },
    { text: "Potato", tier: 10 },
    { text: "Brussels sprouts", aliases: ["brussel sprouts"], tier: 30 },
    { text: "Broccoli", aliases: ["brocoli"], tier: 10 },
    { text: "Grey squash", tier: 85 },
    { text: "Romanesco", tier: 100 },
  ],
};

const idx = {
  fruit: buildIndex(fruit),
  countries: buildIndex(countries),
  eu: buildIndex(eu),
  desserts: buildIndex(desserts),
  animals: buildIndex(animals),
  veg: buildIndex(veg),
};

type Case = [label: string, index: keyof typeof idx, guess: string, expected: string | null, corrected?: boolean];

const cases: Case[] = [
  // Exact + aliases
  ["exact", "fruit", "Banana", "Banana", false],
  ["case and spaces", "fruit", "   bAnAnA  ", "Banana", false],
  ["alias", "fruit", "pitaya", "Dragon fruit", false],
  ["pre-generated misspelling alias", "fruit", "persimon", "Persimmon", false],
  ["abbreviation alias", "countries", "USA", "United States", false],
  ["abbreviation with dots", "countries", "U.S.A.", "United States", false],
  ["leading article", "countries", "the United States", "United States", false],
  ["leading article 'a'", "fruit", "a banana", "Banana", false],
  ["DRC alias", "countries", "DRC", "Democratic Republic of the Congo", false],

  // Typos and transpositions
  ["one-letter typo (len 5-7)", "fruit", "cherrry", "Cherry", true],
  ["transposition counts as 1", "fruit", "bnaana", "Banana", true],
  ["two typos on a long word", "fruit", "persimmmonn", "Persimmon", true],
  ["typo in long word", "fruit", "stawberyy", "Strawberry", true],
  ["too many typos", "fruit", "bnnaaa", null],
  ["short words need exact", "animals", "oxx", null],
  ["unrelated word", "fruit", "carrot", null],

  // Accents
  ["accents stripped", "desserts", "creme brulee", "Crème brûlée", false],
  ["accents kept", "desserts", "CRÈME BRÛLÉE", "Crème brûlée", false],
  ["accented country", "countries", "cote divoire", "Côte d'Ivoire", false],

  // Plurals
  ["simple plural", "fruit", "bananas", "Banana", false],
  ["-ies plural", "fruit", "cherries", "Cherry", false],
  ["-es plural", "fruit", "peaches", "Peach", false],
  ["irregular plural geese", "animals", "geese", "Goose", false],
  ["irregular plural mice", "animals", "mice", "Mouse", false],
  ["irregular plural oxen", "animals", "oxen", "Ox", false],
  ["-oes plural", "veg", "potatoes", "Potato", false],
  ["asparagus not singularized", "veg", "asparagus", "Asparagus", false],
  ["plural of multi-word", "fruit", "dragon fruits", "Dragon fruit", false],
  ["singular of plural answer", "desserts", "chocolate chip cookie", "Chocolate chip cookies", false],
  ["-ie / -ies agree", "desserts", "brownies", "Brownie", false],
  ["brussel sprout", "veg", "brussel sprout", "Brussels sprouts", false],
  ["ponies", "animals", "ponies", "Pony", false],

  // US / UK spelling
  ["grey vs gray", "veg", "gray squash", "Grey squash", false],

  // Iran / Iraq, Austria / Australia
  ["Iran exact", "countries", "Iran", "Iran", false],
  ["Iraq exact", "countries", "Iraq", "Iraq", false],
  ["Irak is too short to fuzz", "countries", "Irak", null],
  ["Austria exact", "countries", "Austria", "Austria", false],
  ["Australia exact", "countries", "Australia", "Australia", false],
  ["Australia typo, clearly closer", "countries", "Austrailia", "Australia", true],
  ["equally close to Austria and Australia", "countries", "Austrlia", null],
  ["Austria typo, clearly closer", "countries", "Austira", "Austria", true],

  // Near-miss blocking
  ["near-miss exact", "eu", "Switzerland", null],
  ["near-miss with typo", "eu", "switzerlnd", null],
  ["near-miss multi-word", "eu", "united kingdom", null],
  ["near-miss closer than answer", "eu", "swedenlnd", null],
  ["near-miss on fruit", "fruit", "tomato sauce", null],
  ["valid answer still fine", "eu", "Sweden", "Sweden", false],
  ["slovenia vs slovakia exact", "eu", "slovakia", "Slovakia", false],

  // Multi-word variants
  ["no space", "desserts", "icecream", "Ice cream", false],
  ["hyphen", "desserts", "ice-cream", "Ice cream", false],
  ["extra spaces", "desserts", "ice    cream", "Ice cream", false],
  ["word order swap", "desserts", "pie apple", "Apple pie", true],
  ["three-word swap", "desserts", "cookies chocolate chip", "Chocolate chip cookies", true],
  ["ampersand = and", "desserts", "rock and roll cake", "Rock & roll cake", false],
  ["and = ampersand", "countries", "Bosnia & Herzegovina", "Bosnia and Herzegovina", false],
  ["hyphen alias", "countries", "congo kinshasa", "Democratic Republic of the Congo", false],
  ["multi-word typo", "fruit", "pasion fruit", "Passion fruit", true],

  // Empty / junk
  ["empty", "fruit", "", null],
  ["punctuation only", "fruit", "?!.", null],
];

describe("matchGuess", () => {
  it.each(cases)("%s: %s ← %j", (_label, which, guess, expected, corrected) => {
    const r = matchGuess(idx[which], guess);
    if (expected === null) {
      expect(r.accepted).toBe(false);
      expect(r.points).toBe(0);
      expect(r.reason).not.toBeNull();
    } else {
      expect(r.accepted).toBe(true);
      expect(r.canonical).toBe(expected);
      expect(r.points).toBe(r.tier);
      if (corrected !== undefined) expect(r.corrected).toBe(corrected);
    }
  });

  it("returns the full result shape", () => {
    expect(matchGuess(idx.fruit, "Persimmon")).toEqual({
      accepted: true,
      answerId: "t-fruit-a4",
      canonical: "Persimmon",
      tier: 60,
      points: 60,
      corrected: false,
      reason: null,
    });
  });

  it("rejects a guess equally close to two answers as ambiguous", () => {
    const q = buildIndex({
      id: "t-amb",
      prompt: "x",
      category: "geography",
      answers: [
        { text: "Mali", tier: 30 },
        { text: "Malta", tier: 30 },
        { text: "Austria", tier: 30 },
        { text: "Austral", tier: 30 },
        { text: "Pineapple", tier: 10 },
      ],
    });
    // "austrai" is one edit from "Austria" (swap) and one from "Austral" (substitution).
    const r = matchGuess(q, "austrai");
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("ambiguous");
  });

  it("near-miss 'wrong' reason and ambiguous reason are distinct", () => {
    expect(matchGuess(idx.eu, "Norway").reason).toBe("wrong");
  });
});

describe("Battle: already-taken answers", () => {
  it("rejects an exact match of a taken answer", () => {
    const taken = new Set(["t-fruit-a0"]);
    const r = matchGuess(idx.fruit, "banana", { takenAnswerIds: taken });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("taken");
    expect(r.canonical).toBe("Banana");
  });

  it("rejects an alias or typo of a taken answer", () => {
    const taken = new Set(["t-fruit-a3"]);
    expect(matchGuess(idx.fruit, "pitaya", { takenAnswerIds: taken }).reason).toBe("taken");
    expect(matchGuess(idx.fruit, "dragon friut", { takenAnswerIds: taken }).reason).toBe("taken");
  });

  it("still accepts answers nobody has taken", () => {
    const taken = new Set(["t-fruit-a0"]);
    expect(matchGuess(idx.fruit, "apple", { takenAnswerIds: taken }).accepted).toBe(true);
  });
});

describe("normalize", () => {
  it.each([
    ["Crème Brûlée", "creme brulee"],
    ["  The   Beatles ", "beatle"],
    ["Rock & Roll", "rock and roll"],
    ["Jack-o'-lantern", "jack o lantern"],
    ["COLOURS", "color"],
    ["organise", "organize"],
    ["A", "a"],
    ["geese", "goose"],
    ["bus", "bus"],
    ["buses", "bus"],
    ["glasses", "glass"],
  ])("%j → %j", (input, out) => {
    expect(normalize(input)).toBe(out);
  });
});

describe("damerauLevenshtein", () => {
  it.each([
    ["", "", 0],
    ["abc", "abc", 0],
    ["abc", "acb", 1],
    ["kitten", "sitting", 3],
    ["ca", "abc", 3],
    ["banana", "bnaana", 1],
  ])("%j vs %j = %i", (a, b, d) => {
    expect(damerauLevenshtein(a, b)).toBe(d);
  });

  it("bails out above max", () => {
    expect(damerauLevenshtein("abcdefgh", "zyxwvuts", 2)).toBe(3);
  });
});
