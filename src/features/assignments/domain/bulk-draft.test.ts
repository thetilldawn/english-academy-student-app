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
  it("순서대로 계획이 생기면 실제 저장 조건도 오름차순으로 맞춘다", () => {
    const next = reduceBulkSeriesAssignmentDraft(createDraft(), {
      type: "common_plan/changed",
      commonPlan,
    });

    expect(next.exam.questionOrderMode).toBe("ascending");
  });

  it("무작위 계획이 생기면 실제 저장 조건도 무작위로 맞춘다", () => {
    const next = reduceBulkSeriesAssignmentDraft(createDraft(), {
      type: "common_plan/changed",
      commonPlan: { ...commonPlan, selectionMode: "random" },
    });

    expect(next.exam.questionOrderMode).toBe("random");
  });
});
