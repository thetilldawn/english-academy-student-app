// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminBreadcrumb } from "./admin-breadcrumb";

afterEach(cleanup);

describe("AdminBreadcrumb", () => {
  it("현재 경로를 페이지의 유일한 1단계 제목으로 표시한다", () => {
    const { container } = render(
      <AdminBreadcrumb current="배정" section="단어 시험" />,
    );

    expect(screen.getByRole("navigation", { name: "현재 위치" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "배정" }))
      .toHaveAttribute("aria-current", "page");
    expect(screen.getByText("단어 시험")).toBeVisible();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
