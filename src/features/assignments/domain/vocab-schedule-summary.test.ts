import { describe, expect, it } from "vitest";

import { resolveVocabScheduleCounts } from "./vocab-schedule";

describe("일정 표시용 회차 요약", () => {
  it.each([
    { scheduleEnabled: true, distribution: "split", slotCount: 0, defaultSessionCount: 5, current: 5, remaining: 0 },
    { scheduleEnabled: true, distribution: "split", slotCount: 7, defaultSessionCount: 5, current: 5, remaining: 0 },
    { scheduleEnabled: true, distribution: "split", slotCount: 2, defaultSessionCount: 5, current: 2, remaining: 3 },
    { scheduleEnabled: true, distribution: "repeat", slotCount: 7, defaultSessionCount: 5, current: 7, remaining: 0 },
    { scheduleEnabled: false, distribution: "split", slotCount: 0, defaultSessionCount: 5, current: 5, remaining: 0 },
    { scheduleEnabled: true, distribution: "split", slotCount: 3, defaultSessionCount: null, current: 3, remaining: null },
  ] as const)("기존 요약 수치 유지: $distribution / 날짜 $scheduleEnabled / 선택 $slotCount", ({ current, remaining, ...input }) => {
    const frozen = Object.freeze({ ...input, requiresExtraDateDecision: false, repeatCycleCount: 1 });
    expect(resolveVocabScheduleCounts(frozen)).toEqual({
      baseSessionCount: input.defaultSessionCount,
      sameRangeEverySession: input.distribution === "repeat",
      currentScheduleCount: current, remainingSessionCount: remaining,
      requiresExtraDateDecision: false, repeatCycleCount: 1,
    });
  });

  it("반복 승인 대기에서는 확인 기준 회차가 우선이며 축소하면 기존 기본 회차로 돌아온다", () => {
    const input = { scheduleEnabled: true, distribution: "split" as const, slotCount: 3,
      defaultSessionCount: 3, extraDateDecisionSessionCount: 2, repeatCycleCount: 2 };
    expect(resolveVocabScheduleCounts({ ...input, requiresExtraDateDecision: true }))
      .toMatchObject({ baseSessionCount: 2, currentScheduleCount: 2 });
    expect(resolveVocabScheduleCounts({ ...input, requiresExtraDateDecision: false, slotCount: 1 }))
      .toMatchObject({ baseSessionCount: 3, currentScheduleCount: 1, remainingSessionCount: 2 });
    expect(resolveVocabScheduleCounts({ ...input, requiresExtraDateDecision: true, extraDateDecisionSessionCount: null }))
      .toMatchObject({ baseSessionCount: 3 });
  });
});
