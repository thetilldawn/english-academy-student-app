// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AssignmentPlannerLoadDialog } from "./assignment-planner-load-dialog";

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

describe("배정 준비 대화상자", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  });

  afterEach(cleanup);

  afterAll(() => {
    HTMLDialogElement.prototype.showModal = originalShowModal;
    HTMLDialogElement.prototype.close = originalClose;
  });

  it("자료를 읽는 동안 회전 표시와 대기 상태를 함께 보여 준다", () => {
    render(
      <AssignmentPlannerLoadDialog onClose={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog");
    const status = screen.getByRole("status");
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("배정 준비 자료를 불러오는 중…");
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("실패하면 오류와 직접 재시도 동작을 보여 준다", () => {
    const onRetry = vi.fn();
    render(
      <AssignmentPlannerLoadDialog
        error="배정 준비 자료를 불러오지 못했습니다."
        onClose={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "배정 준비 자료를 불러오지 못했습니다.",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
