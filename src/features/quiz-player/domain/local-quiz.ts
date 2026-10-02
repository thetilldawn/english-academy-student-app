import type { CommonQuizBody, LocalAnswer, LocalBatch, LocalPhasePlan, LocalQuizRun, LocalReceipt } from "../contracts/local-quiz";
import { canonicalDisplayJson, displayDigest } from "@/lib/quiz/shared-display";

/** One canonical representation in Node and browsers; independent of JSON insertion order. */
export const canonicalLocalJson = canonicalDisplayJson;
export const localDigest = displayDigest;
export async function commonContentKey(body: CommonQuizBody) { return `${body.contentId}:${await localDigest(canonicalLocalJson(body))}`; }
export function localAnswerHash(answer: LocalAnswer) {
  return localDigest([answer.id, answer.order, answer.kind, answer.choice ?? "-", answer.elapsedMs, answer.openedMs].join("|"));
}
export async function receiptConfirmsBatch(batch: LocalBatch, receipt: LocalReceipt) {
  if (receipt.submissionId !== batch.submissionId || receipt.planHash !== batch.planHash || receipt.phase !== batch.phase ||
    receipt.accepted.length !== batch.answers.length || new Set(receipt.accepted.map(a => a.id)).size !== batch.answers.length) return false;
  const hashes = await Promise.all(batch.answers.map(localAnswerHash));
  return batch.answers.every((answer, i) => receipt.accepted[i]?.id === answer.id && receipt.accepted[i]?.answerHash === hashes[i]);
}
export function restoredLocalElapsed(clock: LocalQuizRun["clock"], wallNow: number) {
  if (!Number.isFinite(wallNow) || wallNow < clock.wallAt - 1000) throw new Error("local_clock_recheck_required");
  return Math.floor(clock.elapsedAt + Math.max(0, wallNow - clock.wallAt));
}
export function phaseRemainingMs(plan: LocalPhasePlan, openedMs: number, elapsed: number) {
  return Math.max(0, Math.min(plan.limitMs ?? Infinity, plan.questionLimitMs === null ? Infinity : openedMs + plan.questionLimitMs) - elapsed);
}
export function recordLocalAnswer(run: LocalQuizRun, choice: number | null, elapsedMs: number, wallNow: number, submissionId: string): LocalQuizRun {
  const plan = run.plan;
  if (!plan || run.batch || run.receipt) throw new Error("local_phase_not_active");
  const question = plan.items[run.answers.length];
  if (!question) throw new Error("local_question_missing");
  const elapsed = Math.floor(elapsedMs);
  if (elapsed < run.clock.elapsedAt || !Number.isSafeInteger(elapsed)) throw new Error("local_clock_recheck_required");
  const deadline = plan.limitMs ?? Infinity;
  const due = plan.questionLimitMs === null ? Infinity : run.openedMs + plan.questionLimitMs;
  let answers: LocalAnswer[];
  let reason: "answered" | "deadline" = "answered";
  let finished = elapsed;
  if (choice === null && elapsed >= deadline) {
    reason = "deadline"; finished = deadline;
    answers = [...run.answers, ...plan.items.slice(run.answers.length).map(q => ({ id: q.id, order: q.order, kind: "unanswered" as const,
      choice: null, elapsedMs: deadline, openedMs: Math.min(run.openedMs, deadline) }))];
  } else {
    if (elapsed < run.openedMs) throw new Error("local_question_not_open");
    if (choice !== null && (!Number.isInteger(choice) || choice < 0 || choice > 3 || elapsed > Math.min(due, deadline))) throw new Error("local_answer_too_late");
    if (choice === null && (!Number.isFinite(due) || elapsed < due)) throw new Error("local_timeout_not_due");
    finished = choice === null ? due : elapsed;
    answers = [...run.answers, { id: question.id, order: question.order, kind: choice === null ? "timeout" : "answer", choice, elapsedMs: finished, openedMs: run.openedMs }];
  }
  const batch: LocalBatch | null = answers.length === plan.items.length ? { submissionId, attemptId: plan.attemptId, phase: plan.phase, planHash: plan.planHash,
    answers, completion: { elapsedMs: finished, reason } } : null;
  return { ...run, revision: run.revision + 1, answers, openedMs: finished + 100, batch,
    clock: { wallAt: wallNow, elapsedAt: elapsed } };
}
