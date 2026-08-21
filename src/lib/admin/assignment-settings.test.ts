import { describe, expect, it } from "vitest";

import { assignmentTimingLabel } from "./assignment-settings";

describe("assignmentTimingLabel", () => {
  it.each([
    [
      {
        timingMode: "total" as const,
        timeLimitSeconds: 300,
        questionTimeLimitSeconds: null,
      },
      "전체 5분",
    ],
    [
      {
        timingMode: "total" as const,
        timeLimitSeconds: 90,
        questionTimeLimitSeconds: null,
      },
      "전체 1분 30초",
    ],
    [
      {
        timingMode: "per_question" as const,
        timeLimitSeconds: 10_800,
        questionTimeLimitSeconds: 20,
      },
      "문제당 20초",
    ],
    [
      {
        timingMode: "per_question" as const,
        timeLimitSeconds: 10_800,
        questionTimeLimitSeconds: null,
      },
      "시간 확인 필요",
    ],
  ])("formats the stored timing mode instead of guessing from the cap", (source, expected) => {
    expect(assignmentTimingLabel(source)).toBe(expected);
  });
});
