// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import { useAssignmentWorkspace } from "./use-assignment-workspace";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const data = {
  datasets: [],
  students: [
    {
      id: "student-1",
      displayName: "김학생",
      schoolName: "가학교",
      gradeLabel: "중1",
      currentVocabBook: "VOCA",
      currentVocabDatasetId: null,
      status: "active",
    },
    {
      id: "student-2",
      displayName: "이학생",
      schoolName: "나학교",
      gradeLabel: "중2",
      currentVocabBook: "VOCA",
      currentVocabDatasetId: null,
      status: "active",
    },
  ],
  units: [],
  history: [],
  progress: [],
  pendingReviewSummaries: [],
  currentVocabWrongSummaries: [],
  learningSources: [],
  classGroups: [],
  timeTemplates: [],
} as unknown as AssignmentManagerData;

describe("단어 시험 배정 선택 바구니", () => {
  beforeEach(() => refresh.mockReset());

  it("이름·학교 필터가 바뀌어 목록에서 사라져도 선택한 학생을 유지한다", () => {
    const { result } = renderHook(() => useAssignmentWorkspace({
      data,
      initialDatasetId: "",
      initialDialogView: "overview",
      initialStudentId: "",
    }));

    act(() => result.current.actions.toggleBulkStudent("student-1"));
    act(() => result.current.actions.setFilter("query", "이학생"));
    act(() => result.current.actions.setFilter("school", "나학교"));

    expect(result.current.filteredStudents.map((student) => student.id)).toEqual([
      "student-2",
    ]);
    expect(result.current.selectedBulkStudentIds).toEqual(["student-1"]);
    expect(result.current.selectedBulkStudents[0]?.displayName).toBe("김학생");
  });
});
