import { describe, expect, it } from "vitest";

import { buildVocabAssignmentFieldErrors } from "../presentation/vocab-assignment-field-errors";
import { validateVocabPlannerInputs } from "./vocab-planner-validation";

describe("vocab planner field validation", () => {
  it("maps a past session deadline to that exact deadline input", () => {
    expect(buildVocabAssignmentFieldErrors([{
      code: "invalid_order",
      path: "commonPlan.sessions.1.deadlineLocalDateTime",
      message: "2회차 마감을 확인해 주세요.",
    }])).toMatchObject({
      firstFieldKey: "session-2-deadline",
      errors: {
        "session-2-deadline": "2회차 마감을 확인해 주세요.",
      },
    });
  });

  it("returns separate input paths and focuses the first invalid field", () => {
    const issues = validateVocabPlannerInputs({
      datasetId: "",
      selectedUnitIds: [],
      distribution: "split",
      questionCount: { mode: "manual", value: 3 },
      overflowPolicy: "leave",
      selectionMode: "source_order",
      schedule: {
        availableTime: "25:00",
        deadlineDayOffset: 0,
        deadlineTime: "bad",
        startDate: "bad",
        weekdays: [],
      },
      scheduleSlots: [],
    });
    const result = buildVocabAssignmentFieldErrors(issues);

    expect(result.firstFieldKey).toBe("dataset");
    expect(result.errors).toMatchObject({
      availableTime: "공개 시각을 확인해 주세요.",
      dataset: "단어장을 선택해 주세요.",
      deadlineTime: "마감 시각을 확인해 주세요.",
      questionCount: "문항 수는 4개부터 500개까지 입력해 주세요.",
      range: "시험 범위를 선택해 주세요.",
      startDate: "배정 기준일을 확인해 주세요.",
      weekdays: "배정할 요일을 하나 이상 선택해 주세요.",
    });
  });

  it("maps a session deadline error to its concrete session field", () => {
    const issues = validateVocabPlannerInputs({
      datasetId: "dataset-a",
      selectedUnitIds: ["unit-a"],
      distribution: "split",
      questionCount: { mode: "all" },
      overflowPolicy: "leave",
      selectionMode: "random",
      schedule: {
        availableTime: "16:00",
        deadlineDayOffset: 0,
        deadlineTime: "15:00",
        startDate: "2026-08-21",
        weekdays: [1],
      },
      scheduleSlots: [{
        availableLocalDateTime: "2026-08-24T16:00",
        date: "2026-08-24",
        deadlineLocalDateTime: "2026-08-24T15:00",
        sessionNumber: 1,
      }],
    });

    expect(buildVocabAssignmentFieldErrors(issues)).toMatchObject({
      errors: {
        "session-1-deadline": "1회차 마감은 공개보다 뒤여야 합니다.",
      },
      firstFieldKey: "session-1-deadline",
    });
  });

  it("maps empty per-session dates to the exact available and deadline inputs", () => {
    const issues = validateVocabPlannerInputs({
      datasetId: "dataset-a",
      selectedUnitIds: ["unit-a"],
      distribution: "split",
      questionCount: { mode: "all" },
      overflowPolicy: "leave",
      selectionMode: "source_order",
      schedule: {
        availableTime: "16:00",
        deadlineDayOffset: 0,
        deadlineTime: "22:00",
        startDate: "2026-08-21",
        weekdays: [1],
      },
      scheduleSlots: [{
        availableLocalDateTime: "",
        date: "2026-08-24",
        deadlineLocalDateTime: "bad",
        sessionNumber: 1,
      }],
    });

    expect(buildVocabAssignmentFieldErrors(issues).errors).toMatchObject({
      "session-1-available": "1회차 공개를 확인해 주세요.",
      "session-1-deadline": "1회차 마감을 확인해 주세요.",
    });
  });
});
