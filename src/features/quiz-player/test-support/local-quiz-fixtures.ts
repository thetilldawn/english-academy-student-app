import type { CommonQuizContent, LocalBatch, LocalPhasePlan, LocalQuizRun, LocalReceipt } from "../contracts/local-quiz";
import { commonContentKey, localAnswerHash } from "../domain/local-quiz";

export const localId = (n: number) => `a5050000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function localFixture(count = 3) {
  const pronunciation = { available: false, displayKo: null, variantId: null, audioUrl: null };
  const contents = new Map<string, CommonQuizContent>();
  for (let i = 0; i < count; i++) {
    const body = { contentId: localId(20 + i), quizContentMode: "book_meaning_choice" as const, direction: "english_to_korean" as const,
      prompt: `sample${i + 1}`, choices: ["하나", "둘", "셋", "넷"], pronunciation, choicePronunciations: Array(4).fill(pronunciation) };
    const key = await commonContentKey(body); contents.set(key, { key, body });
  }
  const plan: LocalPhasePlan = { protocol: "local_batch_v1", attemptId: localId(2), phase: "initial", planHash: "a".repeat(64),
    startedAt: new Date(Date.now() - 50).toISOString(), serverNow: new Date().toISOString(), limitMs: null, questionLimitMs: 5000,
    timePolicy: "local-elapsed-v1", status: "in_progress", officialPhase: "initial",
    items: [...contents.values()].map((c, i) => ({ id: localId(10 + i), order: i + 1, contentId: c.body.contentId, correctChoiceIndex: i % 4, priorWrongCount: 0 })) };
  const run: LocalQuizRun = { key: localId(2), revision: 0, identity: "original", studentId: localId(3), device: "c".repeat(64),
    preparation: { protocol: "local_batch_v1", preparationId: localId(2), assignmentId: localId(4), studentId: localId(3), planHash: "b".repeat(64), title: "가짜 학생 검증 시험",
      timingMode: "per_question", questionTimeLimitSeconds: 5, quizContentMode: "book_meaning_choice",
      items: [...contents.values()].map(c => ({ contentId: c.body.contentId, key: c.key })) },
    plan, startRequested: false, answers: [], openedMs: 0, clock: { wallAt: Date.now(), elapsedAt: 50 }, batch: null, receipt: null };
  return { run, contents, plan };
}
export async function receiptFor(batch: LocalBatch, finalized = true): Promise<LocalReceipt> {
  return { protocol: "local_batch_v1", submissionId: batch.submissionId, phase: batch.phase, planHash: batch.planHash, payloadHash: "d".repeat(64),
    accepted: await Promise.all(batch.answers.map(async (a, i) => ({ id: a.id, answerHash: await localAnswerHash(a), sequence: i + 1 }))),
    result: { state: finalized ? "completed" : "review", finalized }, retryTargets: finalized ? [] : batch.answers.map(a => a.id) };
}
