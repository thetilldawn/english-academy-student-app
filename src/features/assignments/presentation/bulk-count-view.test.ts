import { describe, expect, it } from "vitest";
import type { BulkAssignmentPreviewItem } from "../contracts/bulk-assignment-response";
import { bulkCountView } from "./bulk-count-view";

function item(counts: number[]): BulkAssignmentPreviewItem {
  return { studentId: "fake", studentName: "가짜 학생", datasetId: "fake-book", datasetLabel: "가짜 책",
    available: true, error: null, availableQuestionCount: 463, totalAvailableQuestionCount: 601, maximumSessionQuestionCount: 463,
    selectedQuestionCount: 300, remainingQuestionCount: 163, defaultSessionCount: 2,
    scheduledQuestionCount: counts.reduce((a,b) => a+b,0), uniqueScheduledQuestionCount: 300, requiresExtraDateDecision: false,
    sessions: counts.map((questionCount, i) => ({ sessionNumber: i+1, sourceSessionNumber: i+1, cycleIndex: 0,
      unitId: null, unitLabel: null, unitIds: [], unitLabels: [], rangeTruncated: false,
      available: true, questionCount, availableFrom: null, availableUntil: null, error: null })) };
}
describe("배정 합계의 표시 기준", () => {
  it("방향 비율 때문에 기본 분할 상한보다 많은 단어를 반복 회차에서 사용해도 정상 표시한다", () => {
    const view = bulkCountView({ ...item([9, 9]), totalAvailableQuestionCount: 9, maximumSessionQuestionCount: 9,
      uniqueScheduledQuestionCount: 12, countBreakdown: { sourceCount: 12, outsideCandidateListCount: 0,
        activeReviewExcludedCount: 0, directionExcludedCount: 0, choiceExcludedCount: 0, allocationExcludedCount: 3, availableCount: 9 } });
    expect(view.summary).toContain("한 번씩 나눌 때 출제 가능 9개");
    expect(view.summary).toContain("이번 배정 합계 18문항 · 2회 (반복 포함)");
    expect(view.summary).toContain("선택 범위에서 사용 12개 (반복 제외)");
    expect(view.details.join(" ")).toContain("반복 배정에서는 다른 회차에 사용될 수 있습니다");
  });
  it("회차상한 기준 남음163을 전체 미배정 수로 쓰지 않는다", () => {
    const view=bulkCountView(item([300,300]));
    expect(view.summary.join(" ")).toContain("이번 배정 합계 600문항 · 2회 (반복 포함)");
    expect(view.summary.join(" ")).toContain("선택 범위에서 사용 300개 (반복 제외)");
    expect(view.summary.join(" ")).not.toContain("163");
    expect(view.summary.join(" ")).not.toContain("미배정");
  });
  it("실패와 계획 오류에서0개 배정 또는 이전 숫자를 표시하지 않는다", () => {
    const view=bulkCountView({ ...item([300]), available: false, error: "조건 오류", sessions: [] });
    expect(view.summary).toEqual(["배정 합계는 조건을 확인한 뒤 표시합니다."]);
    expect(view.details[0]).toContain("수량을 확인하지 못했습니다");
  });
  it("출제목록 차이를 모두 중복이나 검토 제외라고 단정하지 않는다", () => {
    const view=bulkCountView({ ...item([49]), countBreakdown: { sourceCount:111, outsideCandidateListCount:62,
      activeReviewExcludedCount:0, directionExcludedCount:0, choiceExcludedCount:0, allocationExcludedCount:0, availableCount:49 } });
    expect(view.details.join(" ")).toContain("목록에 없는 항목 62개");
    expect(view.details.join(" ")).toContain("세부 사유는 미확인");
    expect(view.details.join(" ")).not.toContain("검토 제외 62개");
  });
});
