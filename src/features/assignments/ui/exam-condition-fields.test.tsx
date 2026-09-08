// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ExamConditionFields } from "./exam-condition-fields";
import { AssignmentSettingsFields } from "./assignment-settings-fields";
import { singleAssignmentFieldPolicy } from "../domain/assignment-edit-policy";
import type { SingleAssignmentDraft } from "../domain/model";

afterEach(cleanup);
const base = { directionRatio: 50 as const, passingScore: 80, retryEnabled: true, retryPassingScore: 85 };
function callbacks() {
  return { onDirectionChange: vi.fn(), onPassingScoreChange: vi.fn(), onRetryEnabledChange: vi.fn(), onRetryPassingScoreChange: vi.fn() };
}
describe("neutral exam condition fields", () => {
  it("requires only condition values and preserves retry input while hidden", () => {
    const events = callbacks();
    const { rerender } = render(<ExamConditionFields exam={base} {...events} />);
    const retry = screen.getByRole("textbox", { name: "재시험 통과 점수" });
    expect(retry).toHaveValue("85");
    fireEvent.change(retry, { target: { value: "90" } });
    expect(events.onRetryPassingScoreChange).toHaveBeenCalledWith(90);
    rerender(<ExamConditionFields exam={{ ...base, retryEnabled: false }} {...events} />);
    expect(retry.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(retry).not.toBeRequired();
    rerender(<ExamConditionFields exam={base} {...events} />);
    expect(retry.closest('[aria-hidden="true"]')).toBeNull();
    expect(retry).toHaveValue("85");
  });
  it("keeps independent error references and input values", () => {
    render(<ExamConditionFields exam={base} {...callbacks()} idPrefix="local" fieldErrors={{
      direction: "시험 방식을 확인해 주세요.", passingScore: "통과 점수를 확인해 주세요.", retryPassingScore: "재시험 점수를 확인해 주세요.",
    }} />);
    expect(screen.getByRole("group", { name: /^시험 방식/ })).toHaveAttribute("aria-describedby", "local-direction-error");
    expect(screen.getByRole("textbox", { name: "통과 점수" })).toHaveAttribute("aria-errormessage", "local-passing-score-error");
    expect(screen.getByRole("textbox", { name: "재시험 통과 점수" })).toHaveAttribute("aria-errormessage", "local-retry-passing-score-error");
  });
  it.each(["regular", "review"] as const)("actual edit consumer preserves %s field policy", (purpose) => {
    const draft: SingleAssignmentDraft = {
      kind: "single", operation: purpose === "review"
        ? { mode: "replace", assignmentId: "fake-assignment", targetStudentId: "fake-student", sourcePurpose: "review",
          lockedShape: { datasetId: "fake-book", orderedUnitIds: ["fake-unit"], questionCount: 4, reviewScope: "dataset", reviewLevels: [1] } }
        : { mode: "replace", assignmentId: "fake-assignment", targetStudentId: "fake-student", sourcePurpose: "regular" },
      studentId: "fake-student", title: { mode: "custom", value: "검사 시험" },
      range: { datasetId: "fake-book", orderedUnitIds: ["fake-unit"] }, questionCount: { mode: "manual", value: 4 },
      exam: { ...base, questionOrderMode: "ascending", timing: { mode: "total", totalSeconds: 300 } },
      availability: { mode: "immediate" }, deadline: { mode: "none" }, review: { mode: "none", scope: "dataset", levels: [1] },
    };
    const actions: ComponentProps<typeof AssignmentSettingsFields>["actions"] = {
      changeAvailability: vi.fn(), changeDeadline: vi.fn(), changeDirection: vi.fn(), changeOrder: vi.fn(),
      changePassingScore: vi.fn(), changeQuestionCount: vi.fn(), changeRetryEnabled: vi.fn(),
      changeRetryPassingScore: vi.fn(), changeTimeLimitEnabled: vi.fn(), changeTiming: vi.fn(),
      changeTimingMode: vi.fn(), restoreAutomaticCount: vi.fn(),
    };
    const policy = singleAssignmentFieldPolicy(draft);
    const { rerender } = render(<AssignmentSettingsFields actions={actions} capacity={null} draft={draft} fieldPolicy={policy}
      fieldIdPrefix="edit" minimumQuestionCount={1} part="conditions" />);
    const direction = screen.getByRole("button", { name: "뜻 → 영어" });
    expect(direction.hasAttribute("disabled")).toBe(policy.direction !== "editable");
    fireEvent.click(direction);
    expect(actions.changeDirection).toHaveBeenCalledTimes(policy.direction === "editable" ? 1 : 0);
    fireEvent.change(screen.getByRole("textbox", { name: "통과 점수" }), { target: { value: "90" } });
    expect(actions.changePassingScore).toHaveBeenCalledWith(90);
    rerender(<AssignmentSettingsFields actions={actions} capacity={null} draft={draft} fieldPolicy={policy}
      fieldIdPrefix="edit" minimumQuestionCount={1} part="schedule" />);
    const time = screen.getByRole("textbox", { name: "전체 시간(분)" });
    expect(time).toHaveValue("5"); expect(time).toBeRequired();
    fireEvent.change(time, { target: { value: "6" } });
    expect(actions.changeTiming).toHaveBeenCalledWith({ mode: "total", totalSeconds: 360 });
  });
});
