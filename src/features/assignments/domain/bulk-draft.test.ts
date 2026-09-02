import { describe, expect, it } from "vitest";

import {
  createInitialBulkSeriesAssignmentDraft,
  reduceBulkSeriesAssignmentDraft,
} from "./bulk-draft";
import type { BulkCommonAssignmentPlan } from "./model";

const commonPlan: BulkCommonAssignmentPlan = {
  datasetId: "00000000-0000-4000-8000-000000000001",
  distribution: "repeat",
  extraDatePolicy: "unconfirmed",
  orderedUnitIds: ["00000000-0000-4000-8000-000000000002"],
  overflowPolicy: "leave",
  planNonce: "00000000-0000-4000-8000-000000000003",
  questionCount: { mode: "all" },
  rangeUnitCounts: [],
  unitAllocationRule: null,
  recurrenceSessions: [{
    availableLocalDateTime: "2026-08-24T00:00",
    deadlineLocalDateTime: "2026-08-24T22:00",
  }],
  selectedDateCount: 1,
  selectionMode: "source_order",
  sessions: [{
    availableLocalDateTime: "2026-08-24T00:00",
    deadlineLocalDateTime: "2026-08-24T22:00",
    unitIds: ["00000000-0000-4000-8000-000000000002"],
  }],
  splitBasis: "question_count",
};

function createDraft() {
  return createInitialBulkSeriesAssignmentDraft({
    studentIds: ["00000000-0000-4000-8000-000000000004"],
  });
}

describe("일괄 단어 배정 초안", () => {
  it("새 초안은 교재 뜻 시험으로 시작한다", () => {
    expect(createDraft().questionMode).toBe("book_meaning_choice");
  });

  it("영영풀이 또는 예문 유형은 영어 선택 시험으로 고정한다", () => {
    const mixed = reduceBulkSeriesAssignmentDraft(createDraft(), {
      type: "exam/direction_changed",
      value: 50,
    });
    const next = reduceBulkSeriesAssignmentDraft(mixed, {
      type: "exam/question_mode_changed",
      value: "canonical_example_to_headword",
    });

    expect(next.questionMode).toBe("canonical_example_to_headword");
    expect(next.exam.directionRatio).toBe(0);
  });

  it.each([
    ["source_order", "ascending"],
    ["source_order", "random"],
    ["random", "ascending"],
    ["random", "random"],
  ] as const)(
    "출제 단어 %s와 문제 순서 %s를 독립적으로 보존한다",
    (selectionMode, questionOrderMode) => {
      const ordered = reduceBulkSeriesAssignmentDraft(createDraft(), {
        type: "exam/order_changed",
        value: questionOrderMode,
      });
      const next = reduceBulkSeriesAssignmentDraft(ordered, {
        type: "common_plan/changed",
        commonPlan: { ...commonPlan, selectionMode },
      });

      expect(next.exam.questionOrderMode).toBe(questionOrderMode);
      expect(next.commonPlan?.selectionMode).toBe(selectionMode);
    },
  );

  it("초기 시험 문제 순서는 출제 단어 선택과 무관하게 순서대로다", () => {
    const next = reduceBulkSeriesAssignmentDraft(createDraft(), {
      type: "common_plan/changed",
      commonPlan,
    });

    expect(next.exam.questionOrderMode).toBe("ascending");
    expect(next.commonPlan?.selectionMode).toBe("source_order");
  });
});
