// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(async () => ({
    newAssignmentCount: 0,
    deadlineSoonCount: 0,
  })),
}));

vi.mock("@/features/notifications/api/notification-delivery", () => ({
  requestNotificationDelivery: mocks.deliver,
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { NotificationBootstrap } from "./notification-bootstrap";

const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("NotificationBootstrap", () => {
  it("does not recheck when the tab returns within five minutes", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    render(<NotificationBootstrap role="admin" />);
    await act(async () => Promise.resolve());
    expect(mocks.deliver).toHaveBeenCalledOnce();

    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => Promise.resolve());
    expect(mocks.deliver).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);
    });
    expect(mocks.deliver).toHaveBeenCalledTimes(2);
  });

  it("does not start another request while delivery is in progress", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    let finishDelivery: (() => void) | undefined;
    mocks.deliver.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDelivery = () =>
            resolve({ newAssignmentCount: 0, deadlineSoonCount: 0 });
        }),
    );

    render(<NotificationBootstrap role="admin" />);
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.deliver).toHaveBeenCalledOnce();

    await act(async () => finishDelivery?.());
  });
});
