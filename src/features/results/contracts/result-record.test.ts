import { describe, expect, it } from "vitest";
import { resultRecordWire } from "@/test-support/vocabulary-result-fixture";
import { vocabularyResultRecordSchema as schema } from "./result-record";

describe("저장된 결과 계약", () => {
  it("재시험 정답률80을 공식 누적96점으로 바꾸지 않고 보존한다", () => {
    const value = schema.parse(resultRecordWire());
    expect(value.phases[1]).toMatchObject({ score: 96, scoreBasis: "cumulative_after_retry", correctCount: 8, targetCount: 10 });
  });
  it("기록되지 않은 과거 재시험 시각을 null로 유지한다", () => {
    const wire = resultRecordWire({ retentionPolicy: "legacy_answers_preserved", detailScope: "legacy", finalReason: null });
    wire.phases[1].started_at = null;
    wire.attempt.retryStartedAt = null;
    expect(schema.parse(wire).phases[1].startedAt).toBeNull();
    expect(schema.parse(wire).attempt).toMatchObject({ retryStartedAt: null, deadlineAt: null });
  });
  it.each(["missing-initial", "missing-retry", "duplicate", "different-attempt", "count", "basis", "unfinished", "unknown-field"])("잘못된 성공 결과 %s를 빈 결과로 받아들이지 않는다", kind => {
    const wire = resultRecordWire();
    if (kind === "missing-initial") wire.phases.shift();
    if (kind === "missing-retry") wire.phases.pop();
    if (kind === "duplicate") wire.phases[1] = wire.phases[0];
    if (kind === "different-attempt") wire.phases[1].attempt_id = "a4040000-0000-4000-8000-000000000998";
    if (kind === "count") wire.phases[0].correct_count++;
    if (kind === "basis") wire.phases[1].score_basis = "initial_total";
    if (kind === "unfinished") wire.finalized = false;
    expect(schema.safeParse(kind === "unknown-field" ? { ...wire, answer: "not allowed" } : wire).success).toBe(false);
  });
  it("재시험 대기에는 최초 요약만 허용하고 완료로 표시하지 않는다", () => {
    const wire = resultRecordWire({ state: "retry_waiting", finalized: false, retryStarted: false, finalizedAt: null, finalReason: null });
    wire.phases = wire.phases.slice(0, 1);
    expect(schema.parse(wire).finalized).toBe(false);
  });
});
