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

    expect(screen.getByText("기준 일정")).toBeVisible();
    expect(screen.queryByText("동일 조건 2명")).not.toBeInTheDocument();
    expect(screen.queryByText("별도 확인 1명")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "별도 확인" })).toBeVisible();
    expect(screen.getByText("배정 불가")).toBeVisible();
    expect(screen.queryByText("학생 가")).not.toBeInTheDocument();
    expect(screen.queryByText("학생 나")).not.toBeInTheDocument();
    expect(screen.getByText("학생 다 · 테스트고")).toBeVisible();
    expect(screen.getAllByText("1회차")).toHaveLength(2);
  });

  it("shows one student's plan without bulk-only common labels", () => {
    const value = controller();
    value.preview!.items = [value.preview!.items[0]!];
    value.preview!.assignableCount = 1;
    value.preview!.assignmentCount = 1;
    value.preview!.blockedCount = 0;
    value.preview!.commonPlanSummary = {
      ...value.preview!.commonPlanSummary!,
      normalStudentIds: ["student-a"],
      exceptionStudentIds: [],
    };

    render(
      <BulkSeriesPreview
        controller={value}
        students={[{ id: "student-a", displayName: "학생 가" }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "시험 계획" })).toBeVisible();
    expect(screen.queryByText(/공통 1명/)).not.toBeInTheDocument();
    expect(screen.queryByText(/별도 확인 0명/)).not.toBeInTheDocument();
    expect(screen.queryByText("학생 가")).not.toBeInTheDocument();
  });

  it("keeps an invalid one-student preview in the single-plan layout", () => {
    const value = controller();
    value.preview!.items = [
      {
        ...value.preview!.items[0]!,
        available: false,
        error: "범위가 부족합니다.",
        sessions: [],
      },
    ];
    value.preview!.assignableCount = 0;
    value.preview!.assignmentCount = 0;
    value.preview!.blockedCount = 1;
    value.preview!.commonPlanSummary = null;

    render(
      <BulkSeriesPreview
        controller={value}
        students={[{ id: "student-a", displayName: "학생 가" }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "시험 계획" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "학생별 계획" })).not.toBeInTheDocument();
    expect(screen.queryByText("학생 가")).not.toBeInTheDocument();
    expect(screen.getAllByText("범위가 부족합니다.").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("region", { name: "배정 미리보기" }),
    ).toHaveAttribute("aria-describedby", "bulk-series-preview-errors");
    expect(document.getElementById("bulk-series-preview-errors")).toHaveTextContent(
      "범위가 부족합니다.",
    );
  });

  it("shows every plan when a one-person group cannot represent the batch", () => {
    const value = controller();
    value.preview!.commonPlanSummary = {
      ...value.preview!.commonPlanSummary!,
      normalStudentIds: ["student-a"],
      exceptionStudentIds: ["student-b", "student-c"],
    };

    render(
      <BulkSeriesPreview
        controller={value}
        students={[
          { id: "student-a", displayName: "학생 가" },
          { id: "student-b", displayName: "학생 나" },
          { id: "student-c", displayName: "학생 다" },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "학생별 계획" })).toBeVisible();
    expect(screen.queryByText("기준 일정")).not.toBeInTheDocument();
    expect(screen.getByText("학생 가")).toBeVisible();
    expect(screen.getByText("학생 나")).toBeVisible();
    expect(screen.getByText("학생 다")).toBeVisible();
  });

  it("완료 연동 배정에서만 두 번째 회차를 완료 후 생성으로 표시한다", () => {
    const value = controller();
    const secondSession = {
      ...schedule,
      availableFrom: "2026-08-26T07:00:00.000Z",
      availableUntil: "2026-08-26T13:00:00.000Z",
      sessionNumber: 2,
      sourceSessionNumber: 2,
    };
    value.preview!.commonPlanSummary!.sessions = [schedule, secondSession];
    value.preview!.items = value.preview!.items.map((item) => ({
      ...item,
      sessions: item.available
        ? [item.sessions[0]!, { ...secondSession }]
        : item.sessions,
    }));

    const { rerender } = render(
      <BulkSeriesPreview
        controller={value}
        students={[
          { id: "student-a", displayName: "학생 가" },
          { id: "student-b", displayName: "학생 나" },
          { id: "student-c", displayName: "학생 다" },
        ]}
      />,
    );
    expect(screen.queryByText("완료 후 생성")).not.toBeInTheDocument();

    rerender(
      <BulkSeriesPreview
        completionGated
        controller={value}
        students={[
          { id: "student-a", displayName: "학생 가" },
          { id: "student-b", displayName: "학생 나" },
          { id: "student-c", displayName: "학생 다" },
        ]}
      />,
    );
    expect(screen.getAllByText("완료 후 생성")).toHaveLength(1);
  });
});
