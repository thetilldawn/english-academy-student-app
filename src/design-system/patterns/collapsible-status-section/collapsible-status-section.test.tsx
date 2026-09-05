/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { afterEach, describe, expect, it } from "vitest";

import { CollapsibleStatusSection } from "./collapsible-status-section";

afterEach(cleanup);

describe("CollapsibleStatusSection", () => {
  it("exposes the count and controls its region from the heading", async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleStatusSection countLabel="3건" defaultOpen title="응시 전">
        <Link href="/student">첫 시험</Link>
      </CollapsibleStatusSection>,
    );

    const trigger = screen.getByRole("button", { name: "응시 전" });
    const region = screen.getByRole("region", { name: "응시 전" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", region.id);

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(region).toHaveAttribute("aria-hidden", "true");
  });

  it("uses the requested heading level", () => {
    render(
      <CollapsibleStatusSection countLabel="1건" headingLevel={4} title="완료">
        완료 시험
      </CollapsibleStatusSection>,
    );

    expect(screen.getByRole("heading", { level: 4, name: "완료" })).toBeVisible();
  });
});
