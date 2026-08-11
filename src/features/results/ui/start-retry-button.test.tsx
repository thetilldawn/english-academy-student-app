// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { studentAppText } from "@/content/ko/student-app";

import { requestAttemptRetry } from "../api/start-retry";
import { StartRetryButton } from "./start-retry-button";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("../api/start-retry", () => ({
  requestAttemptRetry: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("start retry button", () => {
  it("submits once, disables while pending, and opens the retry attempt", async () => {
    const user = userEvent.setup();
    let resolveRequest: (() => void) | undefined;
    vi.mocked(requestAttemptRetry).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    render(<StartRetryButton attemptId="attempt-1" />);

    const button = screen.getByRole("button", {
      name: studentAppText.actions.retry,
    });
    await user.dblClick(button);

    expect(requestAttemptRetry).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    resolveRequest?.();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/student/attempt/attempt-1"),
    );
  });

  it("shows a retryable alert after a failed request", async () => {
    const user = userEvent.setup();
    vi.mocked(requestAttemptRetry).mockRejectedValueOnce(
      new Error("재시험을 시작하지 못했습니다."),
    );
    render(<StartRetryButton attemptId="attempt-2" />);

    await user.click(
      screen.getByRole("button", { name: studentAppText.actions.retry }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "재시험을 시작하지 못했습니다.",
    );
    expect(
      screen.getByRole("button", { name: studentAppText.actions.retry }),
    ).toBeEnabled();
  });
});
