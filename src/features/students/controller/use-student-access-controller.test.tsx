// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteStudent, revealStudentCode } from "../api/student-mutations";
import type { StudentDetailProfile } from "../contracts/student-detail-read-model";
import { subscribeStudentRemoved } from "./student-directory-events";
import { useStudentAccessController } from "./use-student-access-controller";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/kakao-share", () => ({ sendKakaoText: vi.fn() }));
vi.mock("../api/student-mutations", () => ({
  blockStudent: vi.fn(),
  deleteStudent: vi.fn(),
  revealStudentCode: vi.fn(),
  rotateStudentCode: vi.fn(),
}));

function student(index: number): StudentDetailProfile {
  return {
    codeStatus: "active",
    createdAt: "2026-08-29T00:00:00.000Z",
    currentVocabBook: null,
    currentVocabDatasetId: null,
    displayName: `학생 ${index}`,
    gradeLabel: null,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    rawPoints: 0,
    readingContextSyncStatus: "not_configured",
    readingCurriculumStage: "undecided",
    schoolName: null,
    status: "active",
  };
}

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("useStudentAccessController", () => {
  it("ignores a late code response after the selected student changes", async () => {
    let resolveCode: ((value: { code?: string }) => void) | undefined;
    vi.mocked(revealStudentCode).mockImplementation(
      () => new Promise((resolve) => { resolveCode = resolve; }),
    );
    const callbacks = { onRemoved: vi.fn(), onUpdated: vi.fn() };
    const { result, rerender } = renderHook(
      ({ selected }) => useStudentAccessController({
        appOrigin: "https://preview.example.com",
        ...callbacks,
        student: selected,
      }),
      { initialProps: { selected: student(1) } },
    );

    act(() => { void result.current.actions.revealCode(); });
    await waitFor(() => expect(revealStudentCode).toHaveBeenCalledTimes(1));
    rerender({ selected: student(2) });

    await act(async () => {
      resolveCode?.({ code: "LATE-CODE" });
      await Promise.resolve();
    });
    expect(result.current.code).toBeNull();
    expect(result.current.busyKey).toBe("");
  });

  it("화면이 먼저 닫혀도 삭제 성공 사실을 학생 목록에 전달한다", async () => {
    let resolveDelete: (() => void) | undefined;
    vi.mocked(deleteStudent).mockImplementation(
      () => new Promise((resolve) => {
        resolveDelete = () => resolve({});
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const removed = vi.fn();
    const unsubscribe = subscribeStudentRemoved(removed);
    const callbacks = { onRemoved: vi.fn(), onUpdated: vi.fn() };
    const selected = student(1);
    const { result, unmount } = renderHook(() =>
      useStudentAccessController({
        appOrigin: "https://preview.example.com",
        ...callbacks,
        student: selected,
      })
    );

    act(() => { void result.current.actions.remove(); });
    await waitFor(() => expect(deleteStudent).toHaveBeenCalledWith(selected.id));
    unmount();

    await act(async () => {
      resolveDelete?.();
      await Promise.resolve();
    });
    expect(removed).toHaveBeenCalledWith(selected.id);
    expect(callbacks.onRemoved).not.toHaveBeenCalled();
    unsubscribe();
  });
});
