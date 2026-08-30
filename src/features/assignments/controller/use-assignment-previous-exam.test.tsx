// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAssignmentPreviousExam } from "./use-assignment-previous-exam";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("../transport/assignment-workspace-reads", () => ({
  loadAssignmentPreviousExam: mocks.load,
}));

describe("assignment previous-exam request cache", () => {
  beforeEach(() => {
    mocks.load.mockReset();
    mocks.load.mockResolvedValue({ previousExam: null });
  });

  it("reuses a completed student and dataset result after switching away and back", async () => {
    const { result, rerender } = renderHook(
      ({ datasetId }) => useAssignmentPreviousExam({
        datasetId,
        enabled: true,
        studentId: "student-a",
      }),
      { initialProps: { datasetId: "dataset-a" } },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ datasetId: "dataset-b" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ datasetId: "dataset-a" });

    expect(result.current.status).toBe("ready");
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it("removes only the current cached result when retrying", async () => {
    const { result } = renderHook(() => useAssignmentPreviousExam({
      datasetId: "dataset-a",
      enabled: true,
      studentId: "student-a",
    }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.retry());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("aborts the previous request when the dataset changes", async () => {
    const captured: { signal?: AbortSignal } = {};
    mocks.load.mockImplementationOnce(
      (_request: unknown, signal: AbortSignal) => {
        captured.signal = signal;
        return new Promise(() => undefined);
      },
    );
    const { result, rerender } = renderHook(
      ({ datasetId }) => useAssignmentPreviousExam({
        datasetId,
        enabled: true,
        studentId: "student-a",
      }),
      { initialProps: { datasetId: "dataset-a" } },
    );
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));

    rerender({ datasetId: "dataset-b" });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(captured.signal?.aborted).toBe(true);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
});
