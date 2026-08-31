// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AssignmentStudentItem } from "../catalog-types";
import type { VocabAssignmentScreenData } from "../controller/use-vocab-assignment-screen";
import { VocabAssignmentPlanner } from "./vocab-assignment-planner";

const mocks = vi.hoisted(() => ({
  reviewSubmit: vi.fn(),
  screenSubmit: vi.fn(),
  toastError: vi.fn(),
  useReview: vi.fn(),
  useScreen: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("../controller/use-vocab-assignment-screen", () => ({
  useVocabAssignmentScreen: mocks.useScreen,
}));

vi.mock("../controller/use-direct-review-assignment-controller", () => ({
  useDirectReviewAssignmentController: mocks.useReview,
}));

vi.mock("./direct-review-assignment-sections", () => ({
  DirectReviewAssignmentSections: () => (
    <div data-field-key="deadline">
      <label>
        마감 입력
        <input />
      </label>
    </div>
  ),
}));

vi.mock("./vocab-range-assignment-sections", () => ({
  VocabRangeAssignmentSections: () => <div>범위 배정 내용</div>,
}));

const student = {
  id: "student-1",
  displayName: "프리뷰 학생",
  schoolName: "미리보기고",
} as AssignmentStudentItem;

const data = {
  datasets: [],
  history: [],
  pendingReviewSummaries: [],
  timeTemplates: [],
  units: [],
} as VocabAssignmentScreenData;

function screenController({
  canSubmit = false,
  previewLoading = false,
}: {
  canSubmit?: boolean;
  previewLoading?: boolean;
} = {}) {
  return {
    actions: { submitPlan: mocks.screenSubmit },
    bulk: {
      state: {
        draft: {},
        submission: { status: "idle" },
      },
      previewLoading,
    },
    canSubmit,
    fieldErrors: {},
    firstFieldKey: null,
    planner: {},
    readyDatasets: [],
  };
}

function reviewController(
  status: "idle" | "loading" | "ready",
  canSubmit: boolean,
  calculationPending = status === "loading",
) {
  return {
    actions: { submit: mocks.reviewSubmit },
    calculationPending,
    canSubmit,
    capacity: {
      message: "",
      status,
      value: status === "ready" ? { wrongEligible: 1 } : null,
    },
    draft: { questionCount: status === "ready" ? 1 : 0 },
    fieldErrors: {},
    firstFieldKey: null,
    summary: { status, value: [], message: "" },
    submitting: false,
    userEdited: false,
  };
}

describe("오답 단일 배정 제출", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value() {
        this.removeAttribute("open");
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value(callback: FrameRequestCallback) {
        callback(0);
        return 1;
      },
    });
  });

  beforeEach(() => {
    mocks.reviewSubmit.mockReset();
    mocks.screenSubmit.mockReset();
    mocks.toastError.mockReset();
    mocks.useScreen.mockReset();
    mocks.useReview.mockReset();
    mocks.useScreen.mockReturnValue(screenController());
  });

  afterEach(() => {
    cleanup();
  });

  it("오답 수를 계산하는 동안 배정 버튼을 활성화하지 않는다", () => {
    mocks.useReview.mockReturnValue(reviewController("loading", false));

    render(
      <VocabAssignmentPlanner
        data={data}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        selectionMode="single"
        students={[student]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));

    expect(
      (screen.getByRole("button", { name: "배정하기" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.reviewSubmit).not.toHaveBeenCalled();
  });

  it("범위 미리보기를 계산하는 동안 배정 버튼을 활성화하지 않는다", () => {
    mocks.useReview.mockReturnValue(reviewController("idle", false, false));
    mocks.useScreen.mockReturnValue(screenController({
      canSubmit: false,
      previewLoading: true,
    }));

    render(
      <VocabAssignmentPlanner
        data={data}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        selectionMode="single"
        students={[student]}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "배정하기" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.screenSubmit).not.toHaveBeenCalled();
  });

  it("시험 종류만 확인하고 닫을 때 변경 폐기 확인을 띄우지 않는다", () => {
    mocks.useReview.mockReturnValue(reviewController("ready", true));
    const confirm = vi.spyOn(window, "confirm");
    const onClose = vi.fn();

    render(
      <VocabAssignmentPlanner
        data={data}
        onClose={onClose}
        onSuccess={vi.fn()}
        selectionMode="single"
        students={[student]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("계산이 끝난 1문항 오답 시험을 정확히 한 번 제출하고 닫는다", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    mocks.reviewSubmit.mockResolvedValue({ ok: true, result: {} });
    mocks.useReview.mockReturnValue(reviewController("ready", true));

    render(
      <VocabAssignmentPlanner
        data={data}
        onClose={onClose}
        onSuccess={onSuccess}
        selectionMode="single"
        students={[student]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));
    fireEvent.click(screen.getByRole("button", { name: "배정하기" }));

    await waitFor(() => expect(mocks.reviewSubmit).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith(1, 1, 0);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("제출 중 새로 확인된 마감 오류 입력으로 이동한다", async () => {
    mocks.reviewSubmit.mockResolvedValue({
      fieldKey: "deadline",
      message: "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
      ok: false,
    });
    mocks.useReview.mockReturnValue(reviewController("ready", true));

    render(
      <VocabAssignmentPlanner
        data={data}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        selectionMode="single"
        students={[student]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));
    fireEvent.click(screen.getByRole("button", { name: "배정하기" }));

    await waitFor(() => {
      expect(screen.getByLabelText("마감 입력")).toHaveFocus();
    });
    expect(mocks.toastError).toHaveBeenCalledWith(
      "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
    );
  });

  it("입력 위치가 없는 서버 오류는 오래된 입력으로 이동하지 않는다", async () => {
    mocks.reviewSubmit.mockResolvedValue({
      message: "잠시 후 다시 시도해 주세요.",
      ok: false,
    });
    mocks.useReview.mockReturnValue({
      ...reviewController("ready", true),
      firstFieldKey: "deadline",
    });

    render(
      <VocabAssignmentPlanner
        data={data}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        selectionMode="single"
        students={[student]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));
    fireEvent.click(screen.getByRole("button", { name: "배정하기" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "잠시 후 다시 시도해 주세요.",
      );
    });
    expect(screen.getByLabelText("마감 입력")).not.toHaveFocus();
  });

  it("필수 조건이 비어 있으면 첫 클릭으로 오류를 확인할 수 있다", () => {
    mocks.useReview.mockReturnValue(reviewController("idle", false, false));

    render(
      <VocabAssignmentPlanner
        data={data}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        selectionMode="single"
        students={[student]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));

    const submitButton = screen.getByRole("button", {
      name: "배정하기",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    fireEvent.click(submitButton);

    expect(mocks.reviewSubmit).not.toHaveBeenCalled();
    expect(submitButton.disabled).toBe(true);
  });

  it("필수 조건이 완성된 계산 대기 상태에서는 배정을 잠시 막는다", () => {
    mocks.useReview.mockReturnValue(reviewController("idle", false, true));

    render(
      <VocabAssignmentPlanner
        data={data}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        selectionMode="single"
        students={[student]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));

    expect(
      (screen.getByRole("button", { name: "배정하기" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.reviewSubmit).not.toHaveBeenCalled();
  });

  it("일괄 배정은 학생이 한 명이어도 일괄 제목과 필터를 유지한다", () => {
    mocks.useReview.mockReturnValue(reviewController("ready", true));
    render(
      <VocabAssignmentPlanner
        bulkFilterLabels={["미리보기고", "고3"]}
        data={data}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        selectionMode="bulk"
        students={[student]}
      />,
    );

    expect(screen.getByRole("heading", { name: "일괄 배정" })).toBeVisible();
    expect(screen.getByText("미리보기고")).toBeVisible();
    expect(screen.getByText("고3")).toBeVisible();
    expect(screen.getByText("1명 선택")).toBeVisible();
    expect(screen.getByRole("tab", { name: "오답 시험" }))
      .toHaveAccessibleDescription(
        "오답 시험은 단일 배정에서만 사용할 수 있습니다.",
      );
    expect(screen.getByRole("tab", { name: "오답 시험" })).toBeDisabled();
    expect(
      screen.getByText("오답 시험은 단일 배정에서만 사용할 수 있습니다."),
    ).toBeVisible();
  });
});
