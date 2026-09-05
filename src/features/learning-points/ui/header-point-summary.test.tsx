/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HeaderPointSummary } from "./header-point-summary";

afterEach(cleanup);

describe("HeaderPointSummary", () => {
  it.each([[0, "0"], [-3, "0"], [12345, "12,345"], [Number.MAX_SAFE_INTEGER, "9,007,199,254,740,991"]])(
    "uses the existing visible-point rule for %s", (value, label) => {
      render(<HeaderPointSummary currentPoints={value as number} />);
      expect(screen.getByRole("status")).toHaveTextContent(`포인트${label}`);
      expect(screen.getByRole("status")).toHaveAttribute("data-header-points", "ready");
    },
  );

  it("distinguishes loading and failed reads from a real zero", () => {
    const { rerender } = render(<HeaderPointSummary state="loading" />);
    expect(screen.getByRole("status")).toHaveTextContent("확인 중");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    rerender(<HeaderPointSummary state="unavailable" />);
    expect(screen.getByRole("status")).toHaveTextContent("확인 불가");
    expect(screen.getByRole("status")).not.toHaveTextContent("0");
    rerender(<HeaderPointSummary currentPoints={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("포인트0");
  });
});
