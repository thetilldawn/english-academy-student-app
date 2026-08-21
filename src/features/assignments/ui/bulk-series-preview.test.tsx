// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import { BulkSeriesPreview } from "./bulk-series-preview";

const schedule = {
  available: true,
  availableFrom: "2026-08-24T07:00:00.000Z",
  availableUntil: "2026-08-24T13:00:00.000Z",
  error: null,
  questionCount: 20,
  rangeTruncated: false,
  sessionNumber: 1,
  sourceSessionNumber: 1,
  cycleIndex: 0,
  unitId: "unit-a",
  unitIds: ["unit-a"],
  unitLabel: "DAY 1~DAY 2",
  unitLabels: ["DAY 1", "DAY 2"],
  warnings: [],
  wrongCount: 0,
};

function controller() {
  return {
    message: null,
    previewLoading: false,
    preview: {
      assignableCount: 2,
      assignmentCount: 2,
      blockedCount: 1,
      commonPlanSummary: {
        availableQuestionCount: 86,
        defaultSessionCount: 2,
        exceptionStudentIds: ["student-c"],
        normalStudentIds: ["student-a", "student-b"],
        remainingQuestionCount: 46,
        requiresExtraDateDecision: false,
        representativeStudentId: "student-a",
        selectedQuestionCount: 40,
        scheduledQuestionCount: 40,
        sessions: [schedule],
      },
      items: [
        ["student-a", "학생 가", true, null],
        ["student-b", "학생 나", true, null],
        ["student-c", "학생 다", false, "문항이 부족합니다."],
      ].map(([studentId, studentName, available, error]) => ({
        available,
        availableQuestionCount: 86,
        datasetId: "dataset-a",
        datasetLabel: "테스트 단어장",
        error,
        defaultSessionCount: 2,
        remainingQuestionCount: 46,
        requiresExtraDateDecision: false,
        selectedQuestionCount: 40,
        scheduledQuestionCount: 40,
        sessions: [{
          ...schedule,
          available,
          error,
          questionCount: available ? 20 : 0,
        }],
        studentId,
        studentName,
      })),
    },
    state: {
      draft: { review: { mode: "none" } },
    },
  } as unknown as BulkAssignmentController;
}

afterEach(cleanup);

describe("BulkSeriesPreview", () => {
  it("공통 일정은 한 번만 보여 주고 예외 학생만 따로 펼친다", () => {
    render(
      <BulkSeriesPreview
        controller={controller()}
        students={[
          { id: "student-a", displayName: "학생 가" },
          { id: "student-b", displayName: "학생 나" },
          { id: "student-c", displayName: "학생 다", schoolName: "테스트고" },
        ]}
      />,
    );

    expect(screen.getByText("공통 배정 계획")).toBeVisible();
    expect(screen.getByText("동일 적용 2명")).toBeVisible();
    expect(screen.getByText("확인 필요 1명")).toBeVisible();
    expect(screen.queryByText("학생 가")).not.toBeInTheDocument();
    expect(screen.queryByText("학생 나")).not.toBeInTheDocument();
    expect(screen.getByText("학생 다 · 테스트고")).toBeVisible();
    expect(screen.getAllByText("1회차")).toHaveLength(2);
  });
});
