// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  StudentDirectoryListItem,
  StudentDirectorySnapshot,
} from "@/features/students/public-contracts";
import {
  loadStudentDirectorySnapshot,
} from "@/features/students/public-client";
import { loadAssignmentPlannerPreparation } from "../transport/assignment-workspace-reads";

import { useAssignmentWorkspace } from "./use-assignment-workspace";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/features/students/public-client", () => ({
  loadStudentDirectoryNextPage: vi.fn(),
  loadStudentDirectorySnapshot: vi.fn(),
}));

vi.mock("../transport/assignment-workspace-reads", () => ({
  loadAssignmentDatasetDirectory: vi.fn(),
  loadAssignmentDatasetUnits: vi.fn(),
  loadAssignmentDirectorySelection: vi.fn(),
  loadAssignmentEditContext: vi.fn(),
  loadAssignmentPlannerPreparation: vi.fn(),
  loadAssignmentPreviousExam: vi.fn(),
}));

function student(
  id: string,
  displayName: string,
  schoolName: string,
): StudentDirectoryListItem {
  return {
    codeStatus: "active",
    completedCount: 0,
    currentVocabBook: "VOCA",
    displayName,
    gradeLabel: "중3",
    id,
    missedCount: 0,
    notStartedCount: 0,
    rawPoints: 0,
    recentExamAt: null,
    schoolName,
    status: "active",
  };
}

const students = [
  student("student-1", "김학생", "가학교"),
  student("student-2", "이학생", "나학교"),
];

function snapshot(
  items: StudentDirectoryListItem[],
  query = "",
): StudentDirectorySnapshot {
  return {
    filterOptions: {
      classGroups: [],
      grades: ["중3"],
      schools: ["가학교", "나학교"],
      wordbooks: ["VOCA"],
    },
    filters: {
      classGroupId: "",
      grade: "",
      query,
      school: "",
      status: "active",
      wordbook: "",
      wrong: "all",
    },
    page: { items, nextCursor: null },
    snapshotAt: "2026-08-29T00:00:00.000Z",
    totalCount: items.length,
  };
}

describe("단어 시험 배정 작업공간", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.clearAllMocks();
    vi.mocked(loadAssignmentPlannerPreparation).mockResolvedValue({
      datasets: [],
      initialDatasetId: "",
      initialUnits: [],
      students: [],
      timeTemplates: [],
    });
  });

  it("검색 결과가 바뀌어도 선택 바구니를 유지한다", async () => {
    vi.mocked(loadStudentDirectorySnapshot).mockResolvedValue(
      snapshot([students[1]!], "이학생"),
    );
    const { result } = renderHook(() => useAssignmentWorkspace({
      initial: { directory: snapshot(students) },
      initialDatasetId: "",
      initialDialogView: "overview",
      initialStudentId: "",
    }));

    act(() => result.current.actions.toggleBulkStudent(students[0]!));
    act(() => result.current.actions.setFilter("query", "이학생"));

    await waitFor(() => expect(result.current.directory.filtering).toBe(false));
    expect(result.current.directory.snapshot.page.items.map(({ id }) => id))
      .toEqual(["student-2"]);
    expect(result.current.selectedBulkStudentIds).toEqual(["student-1"]);
    expect(result.current.selectedBulkStudents[0]?.displayName).toBe("김학생");
  });

  it("단일·일괄 배정이 같은 준비 흐름에 정확한 학생을 전달한다", async () => {
    const { result } = renderHook(() => useAssignmentWorkspace({
      initial: { directory: snapshot(students) },
      initialDatasetId: "",
      initialDialogView: "overview",
      initialStudentId: "",
    }));

    act(() => result.current.actions.openSingleAssignment("student-1"));
    expect(result.current.planner.request?.studentIds).toEqual(["student-1"]);

    act(() => result.current.actions.changeAssignmentMode("bulk"));
    act(() => {
      result.current.actions.toggleBulkStudent(students[0]!);
      result.current.actions.toggleBulkStudent(students[1]!);
    });
    act(() => result.current.actions.prepareBulkAssignment());

    expect(result.current.planner.request).toMatchObject({
      selectionMode: "bulk",
      studentIds: ["student-1", "student-2"],
    });
    await waitFor(() => expect(loadAssignmentPlannerPreparation).toHaveBeenCalled());
  });

  it("필터 초기화는 검색어와 선택 바구니를 보존한다", () => {
    const initial = snapshot(students, "김학생");
    const { result } = renderHook(() => useAssignmentWorkspace({
      initial: { directory: initial },
      initialDatasetId: "",
      initialDialogView: "overview",
      initialStudentId: "",
    }));

    act(() => result.current.actions.toggleBulkStudent(students[0]!));
    act(() => result.current.actions.resetFilters());

    expect(result.current.filters.query).toBe("김학생");
    expect(result.current.selectedBulkStudentIds).toEqual(["student-1"]);
  });
});
