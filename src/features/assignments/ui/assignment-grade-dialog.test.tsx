// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AssignmentGradeDialog } from "./assignment-grade-dialog";
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);
describe("학년 확인 창", () => {
  it("다른 학생과 세 선택지만 보여주고 각 동작을 구분한다", () => {
    const onCancel = vi.fn(), onExclude = vi.fn(), onInclude = vi.fn();
    render(<AssignmentGradeDialog datasetGrade="고1" students={[{ studentId: "fake", displayName: "가짜 학생", gradeLabel: "고2" }]}
      unknownCount={1} busy={false} {...{ onCancel, onExclude, onInclude }} />);
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName("학년이 다른 학생이 있습니다");
    expect(screen.getByText("가짜 학생")).toBeVisible();
    expect(screen.getByText(/학년을 비교할 수 없는 학생 1명/)).toBeVisible();
    for (const [label, handler] of [["돌아가기", onCancel], ["제외하기", onExclude], ["포함하기", onInclude]] as const) {
      fireEvent.click(screen.getByRole("button", { name: label })); expect(handler).toHaveBeenCalledOnce();
    }
  });
  it("저장 중에는 중복 선택을 받지 않는다", () => {
    const action = vi.fn();
    render(<AssignmentGradeDialog datasetGrade="고1" students={[]} unknownCount={0} busy onCancel={action} onExclude={action} onInclude={action} />);
    screen.getAllByRole("button").forEach(button => { expect(button).toBeDisabled(); fireEvent.click(button); });
    expect(action).not.toHaveBeenCalled();
  });
});
