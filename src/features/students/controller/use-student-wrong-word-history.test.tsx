// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";

import { loadStudentWrongWords } from "../api/wrong-word-transport";
import { useStudentWrongWordHistory } from "./use-student-wrong-word-history";

vi.mock("../api/wrong-word-transport", () => ({
  loadStudentWrongWords: vi.fn(),
}));

const emptyHistory: StudentWrongWordHistory = {
  pendingReviewCount: 0,
  pendingReviews: [],
  onceWrongWordCount: 0,
  repeatedWrongWordCount: 0,
  uniqueWordCount: 0,
  words: [],
  wrongEventCount: 0,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("student wrong word history controller", () => {
  it("does not let an aborted student request unlock or overwrite the next one", async () => {
    const requests: Array<{
      resolve: (value: { history: StudentWrongWordHistory }) => void;
      signal: AbortSignal;
      studentId: string;
    }> = [];
    vi.mocked(loadStudentWrongWords).mockImplementation(
      (studentId, signal) =>
        new Promise((resolve) => {
          requests.push({ resolve, signal, studentId });
        }),
    );
    const onLoaded = vi.fn();
    const { result, rerender } = renderHook(
      ({ studentId }) =>
        useStudentWrongWordHistory({
          active: true,
          cachedAt: null,
          cachedHistory: null,
          loadErrorMessage: "불러오기 실패",
          onLoaded,
          studentId,
        }),
      { initialProps: { studentId: "student-a" } },
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(result.current.isRequesting()).toBe(true);

    rerender({ studentId: "student-b" });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(result.current.isRequesting()).toBe(true);

    await act(async () => {
      requests[0]?.resolve({ history: emptyHistory });
      await Promise.resolve();
    });
    expect(onLoaded).not.toHaveBeenCalled();
    expect(result.current.isRequesting()).toBe(true);

    await act(async () => {
      requests[1]?.resolve({ history: emptyHistory });
      await Promise.resolve();
    });
    expect(onLoaded).toHaveBeenCalledWith("student-b", emptyHistory);
    expect(result.current.isRequesting()).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("reuses a fresh cached history until refresh is requested", async () => {
    vi.mocked(loadStudentWrongWords).mockResolvedValue({
      history: emptyHistory,
    });
    const onLoaded = vi.fn();
    const cachedAt = Date.now();
    const { result } = renderHook(() =>
      useStudentWrongWordHistory({
        active: true,
        cachedAt,
        cachedHistory: emptyHistory,
        loadErrorMessage: "불러오기 실패",
        onLoaded,
        studentId: "student-a",
      }),
    );

    expect(loadStudentWrongWords).not.toHaveBeenCalled();
    act(() => result.current.refresh());

    await waitFor(() =>
      expect(loadStudentWrongWords).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(onLoaded).toHaveBeenCalledWith("student-a", emptyHistory),
    );
  });

  it("coalesces repeated refreshes during a request into one follow-up load", async () => {
    const resolvers: Array<
      (value: { history: StudentWrongWordHistory }) => void
    > = [];
    vi.mocked(loadStudentWrongWords).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const onLoaded = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStudentWrongWordHistory({
        active: true,
        cachedAt: null,
        cachedHistory: null,
        loadErrorMessage: "불러오기 실패",
        onLoaded,
        studentId: "student-a",
      }),
    );

    await waitFor(() =>
      expect(loadStudentWrongWords).toHaveBeenCalledTimes(1),
    );
    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });
    expect(loadStudentWrongWords).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]?.({ history: emptyHistory });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(loadStudentWrongWords).toHaveBeenCalledTimes(2),
    );
    expect(resolvers).toHaveLength(2);
    unmount();
  });
});
