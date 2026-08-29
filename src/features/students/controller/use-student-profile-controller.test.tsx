// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updateStudentProfile } from "../api/student-mutations";
import type { StudentDetailProfile } from "../contracts/student-detail-read-model";
import { useStudentProfileController } from "./use-student-profile-controller";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../api/student-mutations", () => ({ updateStudentProfile: vi.fn() }));

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
};

afterEach(() => vi.resetAllMocks());

describe("useStudentProfileController", () => {
  it("owns only the selected student's profile draft and refresh callback", async () => {
    vi.mocked(updateStudentProfile).mockResolvedValue({});
    const onUpdated = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentStudent }) => useStudentProfileController({
        onUpdated,
        student: currentStudent,
      }),
      { initialProps: { currentStudent: student } },
    );

    expect(result.current.unchanged).toBe(true);
    act(() => result.current.actions.setField("displayName", "학생 A 수정"));
    expect(result.current.unchanged).toBe(false);
    rerender({
      currentStudent: { ...student, schoolName: "서버에서 바뀐 학교" },
    });
    expect(result.current.draft.displayName).toBe("학생 A 수정");
    expect(result.current.draft.schoolName).toBe("미리보기고");

    await act(async () => result.current.actions.save());
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(result.current.unchanged).toBe(true);
    expect(updateStudentProfile).toHaveBeenCalledWith(student.id, {
      displayName: "학생 A 수정",
      gradeLabel: "고3",
      schoolName: "미리보기고",
    });
  });
});
