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
  it("실제 시간 부품으로 오답 시험의 사용 기본값과 변경을 전달한다", () => {
    const { value } = controller({});
    value.draft.exam.timeLimitEnabled = undefined;
    render(<DirectReviewAssignmentSections onOpenDatasetPicker={vi.fn()} controller={value}
      datasets={[dataset]} fieldErrors={{ timing: "제한 시간을 확인해 주세요." }} student={student} />);
    const input = screen.getByRole("textbox", { name: /^전체 시간/ });
    expect(input).toHaveValue("1"); expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: "2" } });
    expect(value.actions.changeTiming).toHaveBeenCalledWith({ mode: "total", totalSeconds: 120 });
  });
  it("범위 단계/단어장 찾기와 최종 요약도 실제 연결부를 거친다", () => {
    const testController = controller({}); const open = vi.fn();
    render(<DirectReviewAssignmentSections onOpenDatasetPicker={open} controller={testController.value}
      datasets={[dataset]} fieldErrors={{}} student={student} />);
    fireEvent.click(screen.getByRole("button", { name: "1회 1개" }));
    expect(testController.value.actions.toggleReviewLevel).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: /테스트 단어장.*단어장 찾기/ }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByText("오답 · 1회")).toBeInTheDocument();
    expect(screen.getByText("시간 제한 없음")).toBeInTheDocument();
  });
  it("실제 공통 시험 조건은 오답 전용 동작과 연결된다", () => {
    const testController = controller({});
    render(<DirectReviewAssignmentSections onOpenDatasetPicker={vi.fn()} controller={testController.value}
      datasets={[dataset]} fieldErrors={{ passingScore: "점수를 확인해 주세요." }} student={student} />);
    const score = screen.getByRole("textbox", { name: "통과 점수" });
    expect(score).toHaveValue("80");
    expect(score).toHaveAttribute("aria-errormessage", "review-passing-score-error");
    fireEvent.change(score, { target: { value: "85" } });
    expect(testController.value.actions.changePassingScore).toHaveBeenCalledWith(85);
    fireEvent.click(screen.getByRole("button", { name: "뜻 → 영어" }));
    expect(testController.value.actions.changeDirection).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "무작위" }));
    expect(testController.value.actions.changeOrder).toHaveBeenCalledWith("random");
  });
  it("요약 조회 오류는 다시 불러오기 동작에 연결한다", () => {
    const testController = controller({ summaryError: "오답을 불러오지 못했습니다." });
    render(
      <DirectReviewAssignmentSections onOpenDatasetPicker={vi.fn()}
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
      <DirectReviewAssignmentSections onOpenDatasetPicker={vi.fn()}
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
