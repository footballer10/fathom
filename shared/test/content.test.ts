import { describe, expect, it } from "vitest";
import { parsePlainText, serializeFixes, serializeQuestion, validateQuestions } from "../src";
import type { AnswerData, TierPoints } from "../src";

const SAMPLE = `
// a comment
# QUESTION
date: 2026-11-02
slot: 1
category: food
prompt: Name a fruit
note: Botanical edge cases (tomato, cucumber) count as Too Clever.

[One in a Krillion]
Jabuticaba | jaboticaba

[deep cut]
Cherimoya | custard apple
Salak | snake fruit

[Rare]
Persimmon | persimon

[Schooler]
Apricot

[Too Clever]
Dragon fruit | pitaya | pitahaya | dragonfruit

[Plankton]
Apple | apples
Banana | bananas | banan

[Not accepted]
Tomato sauce

# QUESTION
pool: unlimited
category: animals
prompt: Name a dog breed
[Plankton]
Poodle

# FIXES
question: q0142
alias: Persimmon | persimen
add: Rare | Salak | snake fruit
reject: tomato sauce
`;

describe("plain-text parser", () => {
  const r = parsePlainText(SAMPLE);

  it("parses questions, tiers, aliases and near-misses", () => {
    expect(r.errors).toEqual([]);
    expect(r.questions).toHaveLength(2);
    const q = r.questions[0];
    expect(q).toMatchObject({ date: "2026-11-02", slot: 1, category: "food", prompt: "Name a fruit" });
    expect(q.note).toContain("Botanical");
    expect(q.answers.find((a) => a.text === "Jabuticaba")).toEqual({ text: "Jabuticaba", aliases: ["jaboticaba"], tier: 100 });
    expect(q.answers.find((a) => a.text === "Cherimoya")?.tier).toBe(85); // header is case-insensitive
    expect(q.answers.find((a) => a.text === "Apricot")).toEqual({ text: "Apricot", tier: 30 });
    expect(q.nearMisses).toEqual(["Tomato sauce"]);
    expect(r.questions[1].pool).toBe("unlimited");
  });

  it("parses FIXES blocks", () => {
    expect(r.fixes).toEqual([
      {
        questionId: "q0142",
        aliases: [{ answer: "Persimmon", aliases: ["persimen"] }],
        adds: [{ tier: 60, text: "Salak", aliases: ["snake fruit"] }],
        rejects: ["tomato sauce"],
        line: expect.any(Number),
      },
    ]);
  });

  it("round-trips through the serializer", () => {
    const again = parsePlainText(r.questions.map(serializeQuestion).join("\n") + serializeFixes(r.fixes[0]));
    expect(again.errors).toEqual([]);
    expect(again.questions.map(({ line: _l, ...q }) => q)).toEqual(r.questions.map(({ line: _l, ...q }) => q));
    expect(again.fixes[0].adds).toEqual(r.fixes[0].adds);
  });

  it("reports helpful errors", () => {
    const bad = parsePlainText(`stray line
# QUESTION
date: 2026-13-x
slot: 9
color: blue
category: food
prompt: Name a thing
[Legendary]
Foo
# FIXES
add: Mythic | Foo
`);
    const msgs = bad.errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/outside/);
    expect(msgs).toMatch(/Date must/);
    expect(msgs).toMatch(/Slot must/);
    expect(msgs).toMatch(/Unknown field "color:"/);
    expect(msgs).toMatch(/Unknown tier header/);
    expect(msgs).toMatch(/needs a tier name/);
    expect(msgs).toMatch(/missing `question:`/);
  });
});

/** Build a valid 80-answer question with a plausible tier spread. */
function goodQuestion(prompt = "Name a widget", extra: Partial<{ date: string; slot: number }> = {}) {
  const tiers: TierPoints[] = [100, ...Array(7).fill(10), ...Array(3).fill(15), ...Array(20).fill(30), ...Array(27).fill(60), ...Array(22).fill(85)];
  const answers: AnswerData[] = tiers.map((tier, i) => ({ text: `Widget ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}zz${i}`, tier }));
  return { prompt, category: "everyday-objects", answers, nearMisses: ["gadget"], ...extra };
}

describe("validator", () => {
  it("passes a good question", () => {
    const r = validateQuestions([goodQuestion()]);
    expect(r.ok).toBe(true);
  });

  it("fails small pools, missing krillion, bad categories and long prompts", () => {
    const q = goodQuestion("x".repeat(81));
    q.answers = q.answers.slice(1, 40);
    q.category = "space";
    const r = validateQuestions([q]);
    const e = r.reports[0].errors.join("\n");
    expect(r.ok).toBe(false);
    expect(e).toMatch(/Only 39 answers/);
    expect(e).toMatch(/exactly one One in a Krillion/);
    expect(e).toMatch(/Category "space"/);
    expect(e).toMatch(/81 characters/);
  });

  it("fails duplicate normalized forms across answers and near-miss collisions", () => {
    const q = goodQuestion();
    q.answers[5] = { ...q.answers[5], aliases: [q.answers[6].text.toUpperCase() + "s"] };
    q.nearMisses = [q.answers[10].text];
    const e = validateQuestions([q]).reports[0].errors.join("\n");
    expect(e).toMatch(/duplicates/);
    expect(e).toMatch(/collides/);
  });

  it("fails duplicate prompts and taken Daily slots", () => {
    const ctx = {
      existingPrompts: new Map([["nameawidget", "q0001"]]),
      takenSlots: new Map([["2026-11-02#1", "q0002"]]),
    };
    const r = validateQuestions([goodQuestion("Name a widget!"), goodQuestion("Name a gizmo", { date: "2026-11-02", slot: 1 }), goodQuestion("Name a gizmo")], ctx);
    expect(r.reports[0].errors.join()).toMatch(/already exists/);
    expect(r.reports[1].errors.join()).toMatch(/already has a question/);
    expect(r.reports[2].errors.join()).toMatch(/Same prompt as question #2/);
    const replaced = validateQuestions([goodQuestion("Name a gizmo", { date: "2026-11-02", slot: 1 })], { ...ctx, replace: true });
    expect(replaced.ok).toBe(true);
  });

  it("warns on tier spread and one-typo-apart answers", () => {
    const q = goodQuestion();
    q.answers.push({ text: "Iceland", tier: 30 }, { text: "Ireland", tier: 30 });
    q.answers.forEach((a) => a.tier === 15 && (a.tier = 30));
    const w = validateQuestions([q]).reports[0].warnings.join("\n");
    expect(w).toMatch(/Too Clever: 0/);
    expect(w).toMatch(/Iceland \/ Ireland/);
  });
});
