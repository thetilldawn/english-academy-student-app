// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssignmentManagerData } from "@/lib/admin/assignment-manager-data";

import { useAssignmentWorkspace } from "./use-assignment-workspace";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const data = {
  datasets: [
    {
      id: "dataset-1",
      isActive: true,
      isAssignable: true,
      status: "ready",
    },
  ],
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

  it("단일 배정과 일괄 배정이 같은 계획 창에 서로 정확한 학생을 전달한다", () => {
    const { result } = renderHook(() => useAssignmentWorkspace({
      data,
      initialDatasetId: "",
      initialDialogView: "overview",
      initialStudentId: "",
    }));

    act(() => result.current.actions.openSingleAssignment("student-1"));
    expect(result.current.plannerOpen).toBe(true);
    expect(result.current.plannerStudents.map((student) => student.id)).toEqual([
      "student-1",
    ]);

    act(() => result.current.actions.changeAssignmentMode("bulk"));
    act(() => {
      result.current.actions.toggleBulkStudent("student-1");
      result.current.actions.toggleBulkStudent("student-2");
    });
    act(() => result.current.actions.prepareBulkAssignment());
    expect(result.current.plannerOpen).toBe(true);
    expect(result.current.plannerStudents.map((student) => student.id)).toEqual([
      "student-1",
      "student-2",
    ]);
  });

  it("검색어, 세부 필터, 선택 바구니를 서로 독립적으로 초기화한다", () => {
    const { result } = renderHook(() => useAssignmentWorkspace({
      data,
      initialDatasetId: "",
      initialDialogView: "overview",
      initialStudentId: "",
    }));

    act(() => {
      result.current.actions.toggleBulkStudent("student-1");
      result.current.actions.setFilter("query", "김학생");
      result.current.actions.setFilter("school", "가학교");
      result.current.actions.setFilter("grade", "중1");
    });
    act(() => result.current.actions.resetFilters());

    expect(result.current.filters).toMatchObject({
      query: "김학생",
      school: "",
      grade: "",
      status: "active",
    });
    expect(result.current.selectedBulkStudentIds).toEqual(["student-1"]);

    act(() => result.current.actions.clearSearch());
    expect(result.current.filters.query).toBe("");
    expect(result.current.selectedBulkStudentIds).toEqual(["student-1"]);
  });
});
