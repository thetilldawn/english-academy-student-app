import { describe, expect, it } from "vitest";
import type { QueueResolutionResult } from "../api/queue-actions";
import type { VocabAssignmentQueueSummary } from "@/lib/admin/vocab-assignment-queue";
import { queueAttentionView, queueResolutionView } from "./queue-resolution-view";

function result(action: QueueResolutionResult["resolution"]["action"], status: VocabAssignmentQueueSummary["status"], states: VocabAssignmentQueueSummary["items"][number]["status"][]): QueueResolutionResult {
  const stamp = "2026-09-10T00:00:00.000Z";
  return { version: stamp, resolution: { action, item_id: "2", series_id: "series", student_id: "fake" }, queue: {
    seriesId: "series", studentId: "fake", status, attentionReason: "release_schedule_conflict", datasetLabel: "가짜", rangeLabel: "DAY 1~5",
    totalSessionCount: states.length, completedSessionCount: 1, remainingSessionCount: states.filter(s => ["attention", "queued", "assigned"].includes(s)).length,
    totalQuestionCount: 20 * states.length, remainingQuestionCount: 60, currentAssignmentId: null, nextAvailableFrom: null,
    nextAvailableUntil: null, unitAllocation: null, createdAt: stamp, updatedAt: stamp,
    items: states.map((status, i) => ({ id: String(i + 1), sequenceNumber: i + 1, status, questionCount: 20, unitLabels: [`DAY ${i + 1}`],
      plannedAvailableFrom: stamp, plannedAvailableUntil: stamp, effectiveAvailableFrom: stamp,
      effectiveAvailableUntil: "2026-09-10T13:00:00.000Z", assignmentId: null,
      attentionReason: status === "attention" ? "release_schedule_conflict" : null, materializedAt: null, completedAt: null })) } };
}
describe("회차 처리의 실제 결과 안내", () => {
  it("현재 회차를 뒤 대기 수에 포함하지 않는다", () => {
    expect(queueAttentionView(result("retry", "attention", ["completed", "attention", "queued", "queued", "queued"]).queue))
      .toBe("2회차 · 공개 조건과 마감이 맞지 않아 일정 확인 필요. 뒤에서 3회가 기다리고 있습니다.");
  });
  it("보류가 처리됐어도 다음 마감 정체는 경고한다", () => {
    const view = queueResolutionView(result("skip", "attention", ["completed", "deferred", "attention", "queued", "queued"]));
    expect(view.warning).toBe(true);
    expect(view.message).toContain("2회차를 보류했습니다. 3회차");
    expect(view.message).toContain("뒤에서 2회");
  });
  it("묶음 active만으로 재배정 성공을 선언하지 않는다", () => {
    expect(queueResolutionView(result("retry", "active", ["completed", "attention", "queued"])).warning).toBe(true);
    expect(queueResolutionView(result("retry", "active", ["completed", "assigned", "queued"]))).toEqual({ warning: false,
      message: "2회차를 다시 배정했습니다. 새 일정: 2026-09-10 09:00 ~ 2026-09-10 22:00" });
  });
  it("보류·취소 이력을 완료와 구분하고 다음 일정은 응답 그대로 설명한다", () => {
    expect(queueResolutionView(result("skip", "active", ["completed", "deferred", "assigned"])).message).toContain("3회차 일정: 2026-09-10 09:00");
    expect(queueResolutionView(result("skip", "deferred", ["completed", "deferred"])).message).toContain("이어서 배정할 회차가 없습니다");
    expect(queueResolutionView(result("cancel", "cancelled", ["completed", "cancelled", "cancelled"])).message).toContain("완료·보류 기록은 남습니다");
  });
});
