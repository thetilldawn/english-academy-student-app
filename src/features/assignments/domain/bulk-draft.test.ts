import { describe, expect, it } from "vitest";

import {
  createInitialBulkSeriesAssignmentDraft,
  reduceBulkSeriesAssignmentDraft,
} from "./bulk-draft";
import type { BulkCommonAssignmentPlan } from "./model";

const commonPlan: BulkCommonAssignmentPlan = {
  collisionDecisions: [],
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
    firstAvailableDateKorean: "2026-08-24",
    includePendingReview: false,
    studentIds: ["00000000-0000-4000-8000-000000000004"],
  });
}

describe("일괄 단어 배정 초안", () => {
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
