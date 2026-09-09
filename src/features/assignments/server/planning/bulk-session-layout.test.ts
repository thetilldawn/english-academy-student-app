import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildCommonPlanSummary, extendCommonPlanSchedule } from "./bulk-session-layout";
import type { BulkAssignmentPreviewItem } from "../../contracts/bulk-assignment-response";

it("같은 회차라도 학생별 제외 사유나 실제 사용 수가 다르면 공통 설명으로 합치지 않는다", () => {
  const base: BulkAssignmentPreviewItem = { studentId: "a", studentName: "가짜", datasetId: "book", datasetLabel: "가짜",
    available: true, error: null, availableQuestionCount: 8, totalAvailableQuestionCount: 8, maximumSessionQuestionCount: 8,
    selectedQuestionCount: 8, remainingQuestionCount: 0, defaultSessionCount: 1, scheduledQuestionCount: 8,
    uniqueScheduledQuestionCount: 8, requiresExtraDateDecision: false,
    countBreakdown: { sourceCount: 10, outsideCandidateListCount: 0, activeReviewExcludedCount: 2,
      directionExcludedCount: 0, choiceExcludedCount: 0, allocationExcludedCount: 0, availableCount: 8 },
    sessions: [{ sessionNumber: 1, sourceSessionNumber: 1, cycleIndex: 0, unitId: null, unitLabel: null, unitIds: [],
      unitLabels: [], rangeTruncated: false, available: true, questionCount: 8, availableFrom: null, availableUntil: null, error: null }] };
  const other = { ...base, studentId: "c", countBreakdown: { ...base.countBreakdown!, activeReviewExcludedCount: 0, directionExcludedCount: 2 } };
  expect(buildCommonPlanSummary([base, { ...base, studentId: "b" }, other])).toMatchObject({ normalStudentIds: ["a", "b"], exceptionStudentIds: ["c"] });
  expect(buildCommonPlanSummary([base, { ...base, studentId: "b", uniqueScheduledQuestionCount: 7 }])).toBeNull();
});

describe("날짜 없는 실제 회차 일정 확장", () => {
  const undated = { availableFrom: null, availableUntil: null };
  it("기준1회에서 실제4회로 날짜NULL을 보존한다", () => {
    expect(extendCommonPlanSchedule([{ ...undated, sessionNumber: 1 }], [undated], 4))
      .toEqual(Array.from({ length: 4 }, (_, i) => ({ ...undated, sessionNumber: i + 1 })));
  });
  it.each([
    { availableFrom: "2099-09-01T00:00:00Z", availableUntil: null },
    { availableFrom: null, availableUntil: "2099-09-02T00:00:00Z" },
    { availableFrom: "2099-09-01T00:00:00Z", availableUntil: "2099-09-02T00:00:00Z" },
  ])("날짜 없는 회차와 다른 날짜 기준을 혼합하지 않는다: %j", partial => {
    expect(() => extendCommonPlanSchedule([{ ...undated, sessionNumber: 1 }], [partial], 3)).toThrow();
  });
});
