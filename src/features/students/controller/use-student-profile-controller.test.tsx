// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updateStudentProfile } from "../actions/update-student-profile";
import type { StudentDetailProfile } from "../contracts/student-detail-read-model";
import type { StudentProfileMutationReceipt } from "../contracts/student-mutation-result";
import { useStudentProfileController } from "./use-student-profile-controller";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../actions/update-student-profile", () => ({
  updateStudentProfile: vi.fn(),
}));

const student: StudentDetailProfile = {
  codeStatus: "active",
  createdAt: "2026-08-29T00:00:00.000Z",
  currentVocabBook: null,
  currentVocabDatasetId: null,
  displayName: "학생 A",
  gradeLabel: "고3",
  id: "00000000-0000-4000-8000-000000000001",
  rawPoints: -3,
  readingContextSyncStatus: "not_configured",
  readingCurriculumStage: "undecided",
  schoolName: "미리보기고",
  status: "active",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

function receipt(
  displayName = "학생 A 수정",
): StudentProfileMutationReceipt {
  const version = "2026-08-29T00:01:00.000Z";
  return {
    directoryEffect: "refresh-first-page",
    student: {
      displayName,
      gradeLabel: "고3",
      id: student.id,
      schoolName: "미리보기고",
      updatedAt: version,
    },
    version,
  };
}

afterEach(() => vi.resetAllMocks());

describe("useStudentProfileController", () => {
  it("기준 버전과 제출값을 저장하고 서버 영수증을 반영한다", async () => {
    const saved = receipt();
    vi.mocked(updateStudentProfile).mockResolvedValue({
      ok: true,
      receipt: saved,
    });
    const onUpdated = vi.fn();
    const { result } = renderHook(() => useStudentProfileController({
      onUpdated,
      student,
    }));

    act(() => result.current.actions.setField("displayName", "학생 A 수정"));
    await act(async () => result.current.actions.save());

    expect(updateStudentProfile).toHaveBeenCalledWith({
      baseVersion: student.updatedAt,
      displayName: "학생 A 수정",
      gradeLabel: "고3",
      schoolName: "미리보기고",
      studentId: student.id,
    });
    expect(onUpdated).toHaveBeenCalledWith(saved);
    expect(result.current.unchanged).toBe(true);
  });

  it("저장 중 새로 입력한 값은 미저장 상태로 보존한다", async () => {
    let resolveSave: ((value: {
      ok: true;
      receipt: StudentProfileMutationReceipt;
    }) => void) | undefined;
    vi.mocked(updateStudentProfile).mockImplementation(() =>
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    const { result } = renderHook(() => useStudentProfileController({
      onUpdated: vi.fn(),
      student,
    }));

    act(() => result.current.actions.setField("displayName", "첫 제출"));
    let savePromise: Promise<void> | undefined;
    act(() => {
      savePromise = result.current.actions.save();
    });
    act(() => result.current.actions.setField("displayName", "저장 중 새 입력"));
    await act(async () => {
      resolveSave?.({ ok: true, receipt: receipt("첫 제출") });
      await savePromise;
    });

    expect(result.current.draft.displayName).toBe("저장 중 새 입력");
    expect(result.current.unchanged).toBe(false);
  });

  it("충돌이면 초안을 유지하고 같은 틱 중복 제출은 한 번만 보낸다", async () => {
    let resolveSave: ((value: {
      current: StudentProfileMutationReceipt;
      error: string;
      ok: false;
      status: 409;
    }) => void) | undefined;
    vi.mocked(updateStudentProfile).mockImplementation(() =>
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    const onUpdated = vi.fn();
    const { result } = renderHook(() => useStudentProfileController({
      onUpdated,
      student,
    }));

    act(() => result.current.actions.setField("displayName", "충돌 초안"));
    let first: Promise<void> | undefined;
    act(() => {
      first = result.current.actions.save();
      void result.current.actions.save();
    });
    expect(updateStudentProfile).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSave?.({
        current: receipt("다른 관리자 저장값"),
        error: "다른 변경이 먼저 저장되었습니다.",
        ok: false,
        status: 409,
      });
      await first;
    });

    expect(result.current.draft.displayName).toBe("충돌 초안");
    expect(result.current.unchanged).toBe(false);
    expect(onUpdated).toHaveBeenCalledTimes(1);

    vi.mocked(updateStudentProfile).mockResolvedValueOnce({
      ok: true,
      receipt: receipt("충돌 초안"),
    });
    await act(async () => result.current.actions.save());
    expect(updateStudentProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        baseVersion: receipt().version,
        displayName: "충돌 초안",
      }),
    );
  });
});
