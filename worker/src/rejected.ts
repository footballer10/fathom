import { closestAnswer, compact, normalize } from "@fathom/shared";
import type { AnswerIndex } from "@fathom/shared";
import type { Env } from "./env";

/**
 * Every guess that wasn't accepted, from any mode, goes to the weekly review
 * (npm run export:rejected), which decides whether it should have counted.
 */
export function logRejected(env: Env, questionId: string, index: AnswerIndex, text: string, now: number) {
  const key = compact(normalize(text));
  if (!key) return null;
  const closest = closestAnswer(index, text);
  return env.DB.prepare(
    `INSERT INTO rejected_guesses (question_id, normalized, count, closest_answer_id, distance, last_seen)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(question_id, normalized) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen, resolved = 0`,
  ).bind(questionId, normalize(text), closest?.answerId ?? null, closest?.distance ?? null, now);
}

/** Fire-and-forget version for places that shouldn't wait on the database. */
export async function recordRejected(env: Env, questionId: string, index: AnswerIndex, text: string, now: number) {
  const stmt = logRejected(env, questionId, index, text, now);
  if (stmt) await stmt.run().catch((err) => console.error("logRejected", err));
}
