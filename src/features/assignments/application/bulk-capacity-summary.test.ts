import { describe, expect, it } from "vitest";
import { assignmentContractIds as ids, reverseUnitIds } from "@/test-support/assignment-contract-fixtures";
import { createInitialBulkSeriesAssignmentDraft } from "../domain/bulk-draft";
import { resolveVocabQuestionCapacityScope } from "../domain/vocab-question-allocation";
import type { BulkAssignmentPreviewResponse } from "../api/response-adapters";
import { bulkCapacityIdentity, summarizeBulkCapacity } from "./bulk-capacity-summary";

const draft = createInitialBulkSeriesAssignmentDraft({
  studentIds: [ids.studentA],
  commonPlan: {
    datasetId: ids.dataset, distribution: "split", splitBasis: "question_count",
    orderedUnitIds: [...reverseUnitIds], rangeUnitCounts: [], unitAllocationRule: null,
    questionCount: { mode: "manual", value: 100 }, overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed", selectedDateCount: 0, selectionMode: "source_order",
    planNonce: ids.planNonce, recurrenceSessions: [{ availableLocalDateTime: "2099-09-07T09:00", deadlineLocalDateTime: null }],
    sessions: [{ unitIds: [...reverseUnitIds], availableLocalDateTime: "2099-09-07T09:00", deadlineLocalDateTime: null }],
  },
});
const preview: BulkAssignmentPreviewResponse = {
  items: [{
    studentId: ids.studentA, studentName: "가짜 학생", available: false,
    datasetId: ids.dataset, datasetLabel: "가짜 자료", sessions: [],
    availableQuestionCount: 601, totalAvailableQuestionCount: 601, maximumSessionQuestionCount: 500,
    selectedQuestionCount: 0, remainingQuestionCount: 601, defaultSessionCount: 7,
    scheduledQuestionCount: 0, requiresExtraDateDecision: false, error: null,
  }],
  assignableCount: 0, blockedCount: 1, assignmentCount: 0, commonPlanSummary: null,
  planSignature: ids.previewPlanSignature, rangeLabel: "가짜 범위",
};

describe("날짜와 제출에서 분리한 표시용 용량", () => {
  it("601 후보와 한 시험 최대500을 별개로 보존한다", () => {
    expect(resolveVocabQuestionCapacityScope({
      distribution: "repeat", maximumQuestionCount: 500, seriesMaximumQuestionCount: 601,
    })).toEqual({ availableQuestionCount: 500, totalAvailableQuestionCount: 601, maximumSessionQuestionCount: 500 });
    expect(summarizeBulkCapacity(preview, draft)).toEqual({
      status: "ready", totalAvailableQuestionCount: 601, maximumSessionQuestionCount: 500, defaultSessionCount: 7,
    });
  });
  it("날짜 미선택으로 배정불가여도 계산된 용량과 기본 회차는 표시한다", () => {
    expect(preview.items[0]!.available).toBe(false);
    expect(summarizeBulkCapacity(preview, draft).defaultSessionCount).toBe(7);
    expect(summarizeBulkCapacity(preview, draft)).not.toHaveProperty("sessions");
    expect(summarizeBulkCapacity(preview, draft)).not.toHaveProperty("studentName");
  });
  it("날짜와 공개 시각만 바꾸면 같은 범위다", () => {
    expect(bulkCapacityIdentity({ ...draft, commonPlan: { ...draft.commonPlan!,
      selectedDateCount: 2, sessions: [{ ...draft.commonPlan!.sessions[0]!, availableLocalDateTime: "2099-10-07T10:00" }],
      recurrenceSessions: [], extraDatePolicy: "repeat_from_start",
    } })).toBe(bulkCapacityIdentity(draft));
  });
  it.each([
    { studentIds: [ids.studentB] },
    { questionMode: "canonical_example_to_headword" as const },
    { exam: { ...draft.exam, directionRatio: 0 as const } },
    { commonPlan: { ...draft.commonPlan!, orderedUnitIds: [...reverseUnitIds].reverse() } },
    { commonPlan: { ...draft.commonPlan!, questionCount: { mode: "manual" as const, value: 50 } } },
    { commonPlan: { ...draft.commonPlan!, planNonce: ids.studentB } },
    { commonPlan: { ...draft.commonPlan!, selectionMode: "random" as const } },
  ])("학생·유형·방향·범위·수량·섞기 변경은 기존 용량을 폐기한다", patch => {
    expect(bulkCapacityIdentity({ ...draft, ...patch })).not.toBe(bulkCapacityIdentity(draft));
  });
  it("서로 다른 학생 용량은 첫 학생으로 확정하지 않는다", () => {
    const different = { ...preview, items: [...preview.items, { ...preview.items[0]!, studentId: ids.studentB, totalAvailableQuestionCount: 599 }] };
    expect(summarizeBulkCapacity(different, { ...draft, studentIds: [ids.studentA, ids.studentB] }))
      .toMatchObject({ status: "different", defaultSessionCount: null, totalAvailableQuestionCount: null });
  });
  it.each([
    { error: "범위를 확인해 주세요." },
    { datasetId: ids.studentB },
    { studentId: ids.studentB },
    { defaultSessionCount: null },
  ])("실패·대상 불일치·미확정은0이 아니라 미확인이다", patch => {
    expect(summarizeBulkCapacity({ ...preview, items: [{ ...preview.items[0]!, ...patch }] }, draft))
      .toMatchObject({ status: "unavailable", defaultSessionCount: null });
  });
  it("구버전 응답의 총량 누락을 회차 상한으로 대체하지 않는다", () => {
    expect(summarizeBulkCapacity({ ...preview, items: [{ ...preview.items[0]!, totalAvailableQuestionCount: undefined }] }, draft))
      .toMatchObject({ status: "ready", totalAvailableQuestionCount: null, defaultSessionCount: 7 });
  });
});
