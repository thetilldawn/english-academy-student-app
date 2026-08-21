/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssignmentBoundaryRefresh } from "./assignment-boundary-refresh";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.useRealTimers();
});

describe("AssignmentBoundaryRefresh", () => {
  it("refreshes once when a scheduled assignment reaches its opening time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:00:00.000Z"));
    render(
      <AssignmentBoundaryRefresh
        boundaryAt="2026-08-22T00:00:01.000Z"
        initialRemainingMilliseconds={1_000}
      />,
    );

    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("uses the server-derived remaining time when the browser clock is ahead", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T00:05:00.000Z"));
    render(
      <AssignmentBoundaryRefresh
        boundaryAt="2026-08-22T00:00:01.000Z"
        initialRemainingMilliseconds={1_000}
      />,
    );

    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
