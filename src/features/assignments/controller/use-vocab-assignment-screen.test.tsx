// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssignmentDatasetItem, AssignmentStudentItem } from "../catalog-types";
import {
  summarizeVocabAssignmentResult,
  useVocabAssignmentScreen,
  type VocabAssignmentScreenData,
} from "./use-vocab-assignment-screen";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  usePlanner: vi.fn(),
}));

vi.mock("./use-vocab-assignment-planner", () => ({
  useVocabAssignmentPlanner: mocks.usePlanner,
}));

const readyDataset = {
  id: "dataset-ready",
  status: "ready",
  isActive: true,
  isAssignable: true,
} as AssignmentDatasetItem;
const pendingDataset = {
  id: "dataset-pending",
  status: "pending_review",
  isActive: true,
  isAssignable: true,
} as AssignmentDatasetItem;
const students = [
  {
    id: "student-1",
    currentVocabDatasetId: readyDataset.id,
  },
  {
    id: "student-2",
    currentVocabDatasetId: readyDataset.id,
  },
] as AssignmentStudentItem[];
const data = {
  datasets: [pendingDataset, readyDataset],
  history: [],
  units: [],
  timeTemplates: [{
    id: "00000000-0000-4000-8000-000000000111",
    name: "저녁 수업",
    availableTime: "18:00",
    deadlineDayOffset: 1,
    deadlineTime: "22:00",
    timingMode: "total",
    totalSeconds: 300,
    perQuestionSeconds: null,
  }],
} satisfies VocabAssignmentScreenData;

describe("단어 시험 배정 화면과 기능 경계", () => {
  beforeEach(() => {
    mocks.submit.mockReset();
    mocks.usePlanner.mockReset();
    mocks.usePlanner.mockReturnValue({
      actions: {},
      bulk: { actions: { submit: mocks.submit } },
      planner: { schedule: { startDate: "2026-08-21" } },
    });
  });

  it("화면 밖에서 배정 가능한 단어장·기본 범위·시간 템플릿을 준비한다", () => {
    const { result } = renderHook(() => useVocabAssignmentScreen({
      data,
      genericErrorMessage: "저장 실패",
      initialDatasetId: "",
      previewErrorMessage: "미리보기 실패",
      students,
      today: "2026-08-21",
    }));

    expect(result.current.readyDatasets).toEqual([readyDataset]);
    expect(mocks.usePlanner).toHaveBeenLastCalledWith(expect.objectContaining({
      datasets: [readyDataset],
      initialDatasetId: readyDataset.id,
      previousExamSourceStudentId: "student-1",
      studentIds: ["student-1", "student-2"],
      today: "2026-08-21",
      initialTimeTemplates: [expect.objectContaining({
        label: "저녁 수업",
        timing: { mode: "total", totalSeconds: 300 },
      })],
    }));

    act(() =>
      result.current.actions.changePreviousExamSourceStudentId("student-2")
    );
    expect(mocks.usePlanner).toHaveBeenLastCalledWith(expect.objectContaining({
      previousExamSourceStudentId: "student-2",
    }));
  });

  it("저장 응답의 학생·시험 수 집계를 UI에 맡기지 않는다", async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      result: {
        assignments: [
          { student_id: "student-1" },
          { student_id: "student-1" },
          { student_id: "student-2" },
        ],
      },
    });
    const { result } = renderHook(() => useVocabAssignmentScreen({
      data,
      genericErrorMessage: "저장 실패",
      initialDatasetId: readyDataset.id,
      previewErrorMessage: "미리보기 실패",
      students,
      today: "2026-08-21",
    }));

    await expect(result.current.actions.submitPlan()).resolves.toEqual({
      ok: true,
      result: { assignmentCount: 3, studentCount: 2 },
    });
    expect(summarizeVocabAssignmentResult([
      { student_id: "student-1" },
      { student_id: "student-2" },
    ])).toEqual({ assignmentCount: 2, studentCount: 2 });
  });
});
