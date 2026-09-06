import { describe, expect, it } from "vitest";
import { assignmentQuestionModes } from "../domain/model";
import { assignmentQuestionModeView, assignmentQuestionModeScheduleMessage } from "./assignment-question-mode-view";

describe("question mode view", () => {
  it("shows selection guidance even when stale availability is supplied", () => {
    const view = assignmentQuestionModeView({ questionMode: "book_meaning_choice", datasetSelected: false, availableModes: assignmentQuestionModes });
    expect(view.tabs.slice(1).every(t => t.disabled && t.describedBy === "question-mode-dataset-required")).toBe(true);
    expect(view.notices).toEqual([{ id: "question-mode-dataset-required", message: "단어장을 먼저 선택하면 사용할 수 있는 출제 자료가 표시됩니다." }]);
  });
  it("does not turn missing preparation into zero questions", () => {
    const view = assignmentQuestionModeView({ questionMode: "book_meaning_choice", datasetSelected: true });
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]).toMatchObject({ role: "alert", id: "question-mode-status-unavailable" });
    expect(view.notices[0]!.message).toContain("다시 열어 주세요");
    expect(JSON.stringify(view)).not.toMatch(/문항이 없습니다|검토 중|Preview/);
  });
  it("disables only unavailable modes after a valid response", () => {
    const view = assignmentQuestionModeView({ questionMode: "canonical_definition_to_headword", datasetSelected: true,
      availableModes: ["book_meaning_choice", "canonical_definition_to_headword"] });
    expect(view.tabs[1]!.disabled).toBe(false);
    expect(view.tabs[2]).toMatchObject({ disabled: true, describedBy: "example-mode-unavailable" });
    expect(view.notices).toHaveLength(2);
    expect(view.notices[0]!.message).toContain("영어 선택지 4개");
    expect(view.notices[1]!.message).toContain("예문 문항이 없습니다");
  });
  it("uses the same restriction explanation without a Preview-only claim", () => {
    expect(assignmentQuestionModeScheduleMessage("book_meaning_choice")).toBeNull();
    for (const mode of assignmentQuestionModes.slice(1)) {
      expect(assignmentQuestionModeScheduleMessage(mode)).toContain("시험일 없이 1회만 바로 배정");
      expect(assignmentQuestionModeScheduleMessage(mode)).not.toContain("Preview");
    }
  });
});
