// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
} from "../catalog-types";
import type { DirectReviewAssignmentController } from "../controller/use-direct-review-assignment-controller";
import { DirectReviewAssignmentSections } from "./direct-review-assignment-sections";

vi.mock("./assignment-availability-fields", () => ({
  AssignmentAvailabilityFields: () => <div>공개 설정</div>,
}));
vi.mock("./assignment-deadline-fields", () => ({
  AssignmentDeadlineFields: () => <div>마감 설정</div>,
}));
vi.mock("./assignment-section", () => ({
  AssignmentSection: ({
    children,
    title,
  }: {
    children: ReactNode;
    title: string;
  }) => <section><h2>{title}</h2>{children}</section>,
}));
vi.mock("./bulk-exam-fields", () => ({
  ExamConditionFields: () => <div>시험 조건 설정</div>,
  ExamQuestionOrderField: () => <div>문제 순서 설정</div>,
}));
vi.mock("./exam-timing-fields", () => ({
  ExamTimingFields: () => <div>시간 설정</div>,
}));

const dataset = {
  displayName: "테스트 단어장",
  id: "dataset-1",
  title: "테스트 단어장",
} as AssignmentDatasetItem;
const student = {
  displayName: "가짜 학생",
  id: "student-1",
  schoolName: "가짜중",
} as AssignmentStudentItem;

function controller({
  capacityError = "",
  summaryError = "",
}: {
  capacityError?: string;
  summaryError?: string;
}) {
  const retryPreview = vi.fn();
  const retrySummary = vi.fn();
  return {
    value: {
      actions: {
        changeAvailability: vi.fn(),
        changeDataset: vi.fn(),
        changeDeadline: vi.fn(),
        changeDirection: vi.fn(),
        changeOrder: vi.fn(),
        changePassingScore: vi.fn(),
        changeRetryEnabled: vi.fn(),
        changeRetryPassingScore: vi.fn(),
        changeTimeLimitEnabled: vi.fn(),
        changeTiming: vi.fn(),
        changeTimingMode: vi.fn(),
        retryPreview,
        retrySummary,
        submit: vi.fn(),
        toggleReviewLevel: vi.fn(),
      },
      capacity: capacityError
        ? { message: capacityError, status: "error", value: null }
        : {
            fingerprint: "preview-1",
            message: "",
            status: "ready",
            value: {
              wrongEligible: 1,
              wrongLevel1Eligible: 1,
              wrongLevel2Eligible: 0,
            },
          },
      datasetOptions: [{ count: 1, dataset }],
      draft: {
        availability: { mode: "immediate" },
        datasetId: dataset.id,
        deadline: { mode: "none" },
        exam: {
          directionRatio: 100,
          passingScore: 80,
          questionOrderMode: "ascending",
          retryEnabled: false,
          retryPassingScore: 80,
          timeLimitEnabled: false,
          timing: { mode: "total", totalSeconds: 60 },
        },
        questionCount: 1,
        reviewLevels: [1],
        studentId: student.id,
      },
      knownLevelCounts: { level1: 1, level2: 0 },
      summary: summaryError
        ? { message: summaryError, status: "error", value: [] }
        : {
            message: "",
            status: "ready",
            value: [{
              datasetId: dataset.id,
              latestWrongAt: "2026-09-01T00:00:00.000Z",
              level1Count: 1,
              level2Count: 0,
              totalCount: 1,
            }],
          },
      totalAvailableCount: 1,
    } as unknown as DirectReviewAssignmentController,
    retryPreview,
    retrySummary,
  };
}

afterEach(cleanup);

describe("오답 시험 계산 오류 화면", () => {
  it("요약 조회 오류는 다시 불러오기 동작에 연결한다", () => {
    const testController = controller({ summaryError: "오답을 불러오지 못했습니다." });
    render(
      <DirectReviewAssignmentSections
        controller={testController.value}
        datasets={[dataset]}
        fieldErrors={{}}
        student={student}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "오답을 불러오지 못했습니다.",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(testController.retrySummary).toHaveBeenCalledTimes(1);
    expect(testController.retryPreview).not.toHaveBeenCalled();
  });

  it("미리보기 오류는 다시 계산하기 동작에 연결한다", () => {
    const testController = controller({ capacityError: "다시 계산해 주세요." });
    render(
      <DirectReviewAssignmentSections
        controller={testController.value}
        datasets={[dataset]}
        fieldErrors={{}}
        student={student}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("다시 계산해 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "다시 계산하기" }));
    expect(testController.retryPreview).toHaveBeenCalledTimes(1);
    expect(testController.retrySummary).not.toHaveBeenCalled();
  });
});
