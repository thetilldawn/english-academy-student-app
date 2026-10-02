import { z } from "zod";

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true }).nullable();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const phase = z.object({
  attempt_id: z.uuid(), phase: z.enum(["initial", "retry"]), target_count: count.positive(), correct_count: count,
  wrong_count: count, unanswered_count: count, score: z.number().min(0).max(100).nullable(),
  score_basis: z.enum(["initial_total", "cumulative_after_retry"]), passing_score: z.number().int().min(0).max(100).nullable(),
  passed: z.boolean().nullable(), started_at: timestamp, ended_at: timestamp,
  end_reason: z.enum(["completed", "expired", "student_deleted", "legacy_unknown"]),
  evidence: z.enum(["recorded_answers", "legacy_reconstructed"]), content_hash: hash,
}).strict().superRefine((value, ctx) => {
  if (value.correct_count + value.wrong_count + value.unanswered_count !== value.target_count) {
    ctx.addIssue({ code: "custom", message: "단계별 결과 수가 맞지 않습니다." });
  }
  if ((value.phase === "initial") !== (value.score_basis === "initial_total")) {
    ctx.addIssue({ code: "custom", message: "점수 기준이 맞지 않습니다." });
  }
}).transform(value => ({
  attemptId: value.attempt_id, phase: value.phase, targetCount: value.target_count, correctCount: value.correct_count,
  wrongCount: value.wrong_count, unansweredCount: value.unanswered_count, score: value.score, scoreBasis: value.score_basis,
  passingScore: value.passing_score, passed: value.passed, startedAt: value.started_at, endedAt: value.ended_at,
  endReason: value.end_reason, evidence: value.evidence, contentHash: value.content_hash,
}));

export const vocabularyResultRecordSchema = z.object({
  schemaVersion: z.literal("vocabulary-result-v1"), resultVersion: hash,
  retentionPolicy: z.enum(["legacy_answers_preserved", "summary_and_mistakes_v1"]),
  detailScope: z.enum(["legacy", "initial_mistakes", "summary_only"]),
  state: z.enum(["initial_in_progress", "retry_waiting", "retry_in_progress", "completed", "failed", "expired"]),
  finalized: z.boolean(), retryStarted: z.boolean(), finalizedAt: timestamp,
  finalReason: z.enum(["completed", "expired", "student_deleted"]).nullable(), phases: z.array(phase).max(2),
  attempt: z.object({
    status: z.enum(["in_progress", "completed", "expired"]), phase: z.enum(["initial", "review", "retry", "completed"]),
    attemptNumber: count.positive(), questionCount: count.positive(), initialCorrectCount: count.nullable(),
    retryCorrectCount: count.nullable(), unresolvedWrongCount: count.nullable(), initialScore: z.number().min(0).max(100).nullable(),
    finalScore: z.number().min(0).max(100).nullable(), passed: z.boolean().nullable(), elapsedSeconds: count.nullable(),
    startedAt: z.iso.datetime({ offset: true }), initialCompletedAt: timestamp, retryStartedAt: timestamp,
    deadlineAt: timestamp, completedAt: timestamp,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const initial = value.phases.find(item => item.phase === "initial");
  const retry = value.phases.find(item => item.phase === "retry");
  if (new Set(value.phases.map(item => item.phase)).size !== value.phases.length ||
    new Set(value.phases.map(item => item.attemptId)).size > 1 ||
    (value.state !== "initial_in_progress" && !initial) ||
    (retry && (!value.retryStarted || !value.finalized)) ||
    (value.finalized && value.retryStarted && !retry) ||
    value.finalized !== ["completed", "failed", "expired"].includes(value.state) ||
    (value.finalized && value.retentionPolicy === "summary_and_mistakes_v1" && (!value.finalizedAt || !value.finalReason)) ||
    (!value.finalized && (value.finalizedAt !== null || value.finalReason !== null)) ||
    value.finalized !== (value.attempt.status !== "in_progress") ||
    (value.retentionPolicy === "summary_and_mistakes_v1" && value.detailScope === "legacy")) {
    ctx.addIssue({ code: "custom", message: "시험 결과의 확정 상태가 맞지 않습니다." });
  }
});
export type VocabularyResultRecord = z.output<typeof vocabularyResultRecordSchema>;
export type VocabularyPhaseResult = VocabularyResultRecord["phases"][number];
