// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { BulkSeriesPreviewProps } from "./bulk-series-preview";
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
};

function previewProps(): Omit<BulkSeriesPreviewProps, "students"> {
  return {
    message: null,
    previewLoading: false,
    preview: {
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
        ["student-a", "학생 가", true, null] as const,
        ["student-b", "학생 나", true, null] as const,
        ["student-c", "학생 다", false, "문항이 부족합니다."] as const,
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
  };
}

afterEach(cleanup);

describe("BulkSeriesPreview", () => {
  it("최초 계산과 미선택을 작은 값만으로 구분한다", () => {
    const { rerender } = render(<BulkSeriesPreview preview={null} previewLoading message={null} students={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("실제 단어 수와 일정을 계산하고 있습니다.");
    rerender(<BulkSeriesPreview preview={null} previewLoading={false} message={null} students={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("범위와 일정을 정하면 배정 계획을 보여 줍니다.");
  });
  it("공통 일정은 한 번만 보여 주고 예외 학생만 따로 펼친다", () => {
    render(
      <BulkSeriesPreview
        {...previewProps()}
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
    expect(screen.getByText("배정 40개 · 남음 46개")).toBeVisible();
    expect(screen.getAllByText("1회차")).toHaveLength(2);
  });

  it("shows one student's plan without bulk-only common labels", () => {
    const value = previewProps();
    value.preview!.items = [value.preview!.items[0]!];
    value.preview!.commonPlanSummary = {
      ...value.preview!.commonPlanSummary!,
      normalStudentIds: ["student-a"],
      exceptionStudentIds: [],
    };

    render(
      <BulkSeriesPreview
        {...value}
        students={[{ id: "student-a", displayName: "학생 가" }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "시험 계획" })).toBeVisible();
    expect(screen.queryByText(/공통 1명/)).not.toBeInTheDocument();
    expect(screen.queryByText(/별도 확인 0명/)).not.toBeInTheDocument();
    expect(screen.queryByText("학생 가")).not.toBeInTheDocument();
    expect(screen.getByText("20개")).toBeVisible();
  });

  it("keeps an invalid one-student preview in the single-plan layout", () => {
    const value = previewProps();
    value.preview!.items = [
      {
        ...value.preview!.items[0]!,
        available: false,
        error: "범위가 부족합니다.",
        sessions: [],
      },
    ];
    value.preview!.commonPlanSummary = null;

    render(
      <BulkSeriesPreview
        {...value}
        students={[{ id: "student-a", displayName: "학생 가" }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "시험 계획" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "학생별 계획" })).not.toBeInTheDocument();
    expect(screen.queryByText("학생 가")).not.toBeInTheDocument();
    const visibleErrors = screen.getAllByText("범위가 부족합니다.").filter(
      (element) => !element.classList.contains("sr-only"),
    );
    expect(visibleErrors).toHaveLength(1);
    expect(
      screen.getByRole("region", { name: "배정 미리보기" }),
    ).toHaveAttribute("aria-describedby", "bulk-series-preview-errors");
    expect(document.getElementById("bulk-series-preview-errors")).toHaveTextContent(
      "범위가 부족합니다.",
    );
  });

  it("회차 오류와 학생 계획 오류가 같으면 화면에 한 번만 표시한다", () => {
    const value = previewProps();
    value.preview!.items = [{
      ...value.preview!.items[0]!,
      available: false,
      error: "현재 회차는 최대 463개까지 배정할 수 있습니다.",
      sessions: [{
        ...value.preview!.items[0]!.sessions[0]!,
        available: false,
        error: "현재 회차는 최대 463개까지 배정할 수 있습니다.",
        questionCount: 0,
      }],
    }];
    value.preview!.commonPlanSummary = null;

    render(
      <BulkSeriesPreview
        {...value}
        students={[{ id: "student-a", displayName: "학생 가" }]}
      />,
    );

    const visibleErrors = screen.getAllByText(
      "현재 회차는 최대 463개까지 배정할 수 있습니다.",
    ).filter((element) => !element.classList.contains("sr-only"));
    expect(visibleErrors).toHaveLength(1);
  });

  it("shows every plan when a one-person group cannot represent the batch", () => {
    const value = previewProps();
    value.preview!.commonPlanSummary = {
      ...value.preview!.commonPlanSummary!,
      normalStudentIds: ["student-a"],
      exceptionStudentIds: ["student-b", "student-c"],
    };

    render(
      <BulkSeriesPreview
        {...value}
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

  it("날짜 사용 여부와 관계없이 후속 회차의 첫 시험 완료 조건을 표시한다", () => {
    const value = previewProps();
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
        {...value}
        students={[
          { id: "student-a", displayName: "학생 가" },
          { id: "student-b", displayName: "학생 나" },
          { id: "student-c", displayName: "학생 다" },
        ]}
      />,
    );
    expect(screen.queryByText("완료 후 생성")).not.toBeInTheDocument();
    expect(screen.getAllByText("앞 회차 첫 시험 완료 후 공개")).toHaveLength(1);
    value.preview!.commonPlanSummary!.sessions = [schedule, secondSession].map(
      (session) => ({...session, availableFrom:null,availableUntil:null}),
    );

    rerender(
      <BulkSeriesPreview
        {...value}
        students={[
          { id: "student-a", displayName: "학생 가" },
          { id: "student-b", displayName: "학생 나" },
          { id: "student-c", displayName: "학생 다" },
        ]}
      />,
    );
    expect(screen.getAllByText("앞 회차 첫 시험 완료 후 공개")).toHaveLength(1);
  });
});
