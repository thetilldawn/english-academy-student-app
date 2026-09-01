// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssignmentSubmitAction } from "./assignment-submit-action";

afterEach(cleanup);

describe("배정 저장 동작", () => {
  it("저장 중에는 회전 표시를 보여 주고 연속 제출을 막는다", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <>
        <form id="assignment-test-form" onSubmit={onSubmit} />
        <AssignmentSubmitAction
          blockedReason={null}
          canSubmit
          formId="assignment-test-form"
          label="배정 중…"
          pending
        />
      </>,
    );

    const button = screen.getByRole("button", { name: "배정 중…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
