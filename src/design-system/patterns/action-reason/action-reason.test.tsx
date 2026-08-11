// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ActionWithReason } from "./action-reason";

afterEach(cleanup);

describe("ActionWithReason", () => {
  it("places the concise live reason immediately after the action", () => {
    render(
      <ActionWithReason reason="범위 선택">
        <button disabled type="button">
          배정
        </button>
      </ActionWithReason>,
    );

    const button = screen.getByRole("button", { name: "배정" });
    const reason = screen.getByText("범위 선택");
    expect(button.nextElementSibling).toBe(reason);
    expect(reason).toHaveAttribute("aria-live", "polite");
    expect(reason).toHaveAttribute("title", "범위 선택");
  });

  it("marks footer actions for remaining-space centering", () => {
    const { container } = render(
      <ActionWithReason layout="remaining-center" reason="시간 확인">
        <button type="button">배정</button>
      </ActionWithReason>,
    );

    expect(container.firstElementChild).toHaveAttribute(
      "data-layout",
      "remaining-center",
    );
  });
});
