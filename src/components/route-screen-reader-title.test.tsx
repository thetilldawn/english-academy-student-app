// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RouteScreenReaderTitle } from "./route-screen-reader-title";

afterEach(cleanup);

describe("화면 읽기용 페이지 제목", () => {
  it("제목 구조는 남기되 화면에는 보이지 않는다", () => {
    render(<RouteScreenReaderTitle title="배정" />);

    expect(screen.getByRole("heading", { level: 1, name: "배정" }))
      .toHaveClass("sr-only");
  });
});
