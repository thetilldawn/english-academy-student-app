import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { reusableInProgressAttemptId } from "./attempt-start";

describe("reusableInProgressAttemptId", () => {
  const evaluatedAt = Date.parse("2026-08-26T12:00:00.000Z");

  it("reuses only a live initial or retry attempt", () => {
    expect(
      reusableInProgressAttemptId(
        {
          id: "live-attempt",
          phase: "initial",
          deadline_at: "2026-08-26T12:01:00.000Z",
        },
        evaluatedAt,
      ),
    ).toBe("live-attempt");
    expect(
      reusableInProgressAttemptId(
        {
          id: "untimed-attempt",
          phase: "retry",
          deadline_at: "infinity",
        },
        evaluatedAt,
      ),
    ).toBe("untimed-attempt");
  });

  it("falls through to the atomic creation command for an expired attempt", () => {
    expect(
      reusableInProgressAttemptId(
        {
          id: "expired-attempt",
          phase: "initial",
          deadline_at: "2026-08-26T11:59:59.000Z",
        },
        evaluatedAt,
      ),
    ).toBeNull();
  });

  it("새 시험을 만들기 전에 만료된 진행 슬롯을 대상 지정 명령으로 정리한다", () => {
    const source = fs.readFileSync(
      path.resolve("src/lib/services/quiz/attempt-start.ts"),
      "utf8",
    );
    const finalizerIndex = source.indexOf(
      '"finalize_quiz_attempt_if_stale"',
    );
    const bankCreationIndex = source.indexOf('"create_quiz_attempt_from_bank"');
    const legacyCreationIndex = source.indexOf('"create_quiz_attempt"');

    expect(finalizerIndex).toBeGreaterThan(-1);
    expect(finalizerIndex).toBeLessThan(bankCreationIndex);
    expect(finalizerIndex).toBeLessThan(legacyCreationIndex);
  });

  it("keeps the answer-review phase available without changing it", () => {
    expect(
      reusableInProgressAttemptId(
        {
          id: "review-attempt",
          phase: "review",
          deadline_at: "2026-08-26T11:59:59.000Z",
        },
        evaluatedAt,
      ),
    ).toBe("review-attempt");
  });
});
