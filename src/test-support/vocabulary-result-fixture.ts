import type { z } from "zod";
import { vocabularyResultRecordSchema } from "@/features/results/public-contracts";

type Wire = z.input<typeof vocabularyResultRecordSchema>;
export const resultFixtureAttemptId = "a4040000-0000-4000-8000-000000000999";
export function resultRecordWire(overrides: Partial<Wire> = {}): Wire {
  const phase: Wire["phases"][number] = {
    attempt_id: resultFixtureAttemptId, phase: "initial", target_count: 50, correct_count: 40,
    wrong_count: 10, unanswered_count: 0, score: 80, score_basis: "initial_total", passing_score: 90,
    passed: false, started_at: "2026-10-02T01:00:00+00:00", ended_at: "2026-10-02T01:05:00+00:00",
    end_reason: "completed", evidence: "recorded_answers", content_hash: "a".repeat(64),
  };
  return {
    schemaVersion: "vocabulary-result-v1", resultVersion: "b".repeat(64), retentionPolicy: "summary_and_mistakes_v1",
    detailScope: "initial_mistakes", state: "completed", finalized: true, retryStarted: true,
    finalizedAt: "2026-10-02T01:08:00+00:00", finalReason: "completed", phases: [phase, {
      ...phase, phase: "retry", target_count: 10, correct_count: 8, wrong_count: 2,
      score: 96, score_basis: "cumulative_after_retry", passed: true, started_at: "2026-10-02T01:06:00+00:00",
      ended_at: "2026-10-02T01:08:00+00:00", content_hash: "c".repeat(64),
    }], attempt: {
      status: overrides.finalized === false ? "in_progress" : "completed",
      phase: overrides.state === "retry_waiting" ? "review" : overrides.state === "retry_in_progress" ? "retry" : "completed",
      attemptNumber: 1, questionCount: 50, initialCorrectCount: 40, retryCorrectCount: overrides.finalized === false ? 0 : 8, unresolvedWrongCount: overrides.finalized === false ? 10 : 2,
      initialScore: 80, finalScore: overrides.finalized === false ? null : 96, passed: overrides.finalized === false ? null : true, elapsedSeconds: 480, startedAt: "2026-10-02T01:00:00+00:00",
      initialCompletedAt: "2026-10-02T01:05:00+00:00", retryStartedAt: overrides.retryStarted === false ? null : "2026-10-02T01:06:00+00:00",
      deadlineAt: null, completedAt: overrides.finalized === false ? null : "2026-10-02T01:08:00+00:00",
    }, ...overrides,
  };
}
export const resultRecordFixture = (overrides: Partial<Wire> = {}) => vocabularyResultRecordSchema.parse(resultRecordWire(overrides));
