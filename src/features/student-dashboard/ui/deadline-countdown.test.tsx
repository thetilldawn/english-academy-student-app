/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatRemainingSeconds } from "@/lib/deadline";

import { DeadlineCountdown } from "./deadline-countdown";

const { router } = vi.hoisted(() => ({
  router: { refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("DeadlineCountdown", () => {
  it("counts from the server-derived duration instead of the browser clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:05:00.000Z"));
    const browserClockStart = Date.now();
    vi.spyOn(performance, "now").mockImplementation(
      () => Date.now() - browserClockStart,
    );
    render(
      <DeadlineCountdown
        deadlineAt="2026-08-22T00:00:02.000Z"
        initialRemainingSeconds={2}
      />,
    );

    expect(screen.getByRole("timer")).toHaveTextContent(
      formatRemainingSeconds(2),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
    });
    expect(screen.getByRole("timer")).toHaveTextContent(
      formatRemainingSeconds(1),
    );
  });
});
