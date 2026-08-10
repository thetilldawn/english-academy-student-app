// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Button,
  buttonRecipe,
} from "@/design-system/primitives/button/button";
import { Tabs } from "@/design-system/primitives/tabs/tabs";

afterEach(cleanup);

describe("component testing foundation", () => {
  it("uses the shared button contract for an actual click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Button onClick={onClick} size="large" variant="primary">
        시험 배정
      </Button>,
    );

    const button = screen.getByRole("button", { name: "시험 배정" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toBe(
      buttonRecipe({ size: "large", variant: "primary" }),
    );

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("changes tabs with the keyboard and moves focus", async () => {
    const user = userEvent.setup();

    function TabHarness() {
      const [value, setValue] = useState<"learning" | "account">("learning");
      return (
        <Tabs
          ariaLabel="학생 상세"
          items={[
            { value: "learning", label: "학습 관리" },
            { value: "account", label: "계정 설정" },
          ]}
          onChange={setValue}
          value={value}
        />
      );
    }

    render(<TabHarness />);
    const learning = screen.getByRole("tab", { name: "학습 관리" });
    const account = screen.getByRole("tab", { name: "계정 설정" });

    learning.focus();
    await user.keyboard("{ArrowRight}");

    expect(account).toHaveFocus();
    expect(account).toHaveAttribute("aria-selected", "true");
    expect(learning).toHaveAttribute("aria-selected", "false");
  });
});
