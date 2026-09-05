// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Ref } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import type { AssignmentDatasetItem, AssignmentStudentItem } from "../catalog-types";
import type { VocabAssignmentScreenData } from "../controller/use-vocab-assignment-screen";
import { VocabAssignmentPlanner } from "./vocab-assignment-planner";

const mocks = vi.hoisted(() => ({
  reviewSubmit: vi.fn(),
  screenSubmit: vi.fn(),
  toastError: vi.fn(),
  useReview: vi.fn(),
  useScreen: vi.fn(),
  rangeDataset: vi.fn(),
  reviewDataset: vi.fn(),
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
  DirectReviewAssignmentSections: ({ onOpenDatasetPicker, datasetTriggerRef }: {
    onOpenDatasetPicker: () => void;
    datasetTriggerRef: Ref<HTMLButtonElement>;
  }) => (
    <div>
      <button type="button" onClick={onOpenDatasetPicker} ref={datasetTriggerRef}>오답 단어장 찾기</button>
      <label data-field-key="deadline">
        마감 입력
        <input />
      </label>
    </div>
  ),
}));

vi.mock("./vocab-range-assignment-sections", () => ({
  VocabRangeAssignmentSections: ({ onOpenDatasetPicker, datasetTriggerRef }: {
    onOpenDatasetPicker: () => void;
    datasetTriggerRef: Ref<HTMLButtonElement>;
  }) => <div>
    <button type="button" onClick={onOpenDatasetPicker} ref={datasetTriggerRef}>범위 단어장 찾기</button>
    <label>배정 조건 보존<input defaultValue="5회차" /></label>
    <span>범위 배정 내용</span>
  </div>,
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

const datasets: AssignmentDatasetItem[] = ["심석 고1 형용사 500", "심석 고2 영어Ⅱ"].map((title, index) => ({
  ...cataloguedDatasetFromMetadata({ id: `book-${index}`, title }, undefined),
  isActive: true, rowCount: 500, status: "ready",
}));

function screenController({
  canSubmit = false,
  previewLoading = false,
  submitting = false,
}: {
  canSubmit?: boolean;
  previewLoading?: boolean;
  submitting?: boolean;
} = {}) {
  return {
    actions: { submitPlan: mocks.screenSubmit, changeDataset: mocks.rangeDataset },
    bulk: {
      state: {
        draft: {},
        submission: { status: submitting ? "submitting" : "idle" },
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
  status: "error" | "idle" | "loading" | "ready",
  canSubmit: boolean,
  calculationPending = status === "loading",
  submitting = false,
) {
  return {
    actions: { submit: mocks.reviewSubmit, changeDataset: mocks.reviewDataset },
    datasetOptions: [],
    calculationPending,
    canSubmit,
    capacity: {
      message: status === "error" ? "오답 계산 오류" : "",
      status,
      value: status === "ready" ? { wrongEligible: 1 } : null,
    },
    draft: { questionCount: status === "ready" ? 1 : 0 },
    fieldErrors: {},
    firstFieldKey: null,
    summary: {
      status,
      value: [],
      message: status === "error" ? "오답 계산 오류" : "",
    },
    submitting,
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
    mocks.rangeDataset.mockReset();
    mocks.reviewDataset.mockReset();
    window.localStorage.clear();
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

  it("오답 계산 오류가 남아 있으면 배정 버튼을 활성화하지 않는다", () => {
    mocks.useReview.mockReturnValue(reviewController("error", false, false));

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

    expect(screen.getByRole("button", { name: "배정하기" })).toBeDisabled();
    expect(mocks.reviewSubmit).not.toHaveBeenCalled();
  });

  it("배정 중에는 회전 표시와 접근 가능한 대기 상태를 보여 준다", () => {
    mocks.useReview.mockReturnValue(
      reviewController("ready", false, false, true),
    );

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

    const submit = screen.getByRole("button", { name: "배정 중…" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(submit.querySelector('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(submit);
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

  it.each(["single", "bulk"] as const)("%s 배정은 같은 창에서 검색하고 Escape로 조건과 초점을 보존한다", async (selectionMode) => {
    mocks.useScreen.mockReturnValue({
      ...screenController({ canSubmit: true }), readyDatasets: datasets, planner: { datasetId: "" },
    });
    mocks.useReview.mockReturnValue(reviewController("idle", false));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<VocabAssignmentPlanner data={data} onClose={onClose} onSuccess={vi.fn()} selectionMode={selectionMode} students={[student]} />);
    const condition = screen.getByRole("textbox", { name: "배정 조건 보존" });
    await user.clear(condition);
    await user.type(condition, "날짜 없이 5회차");
    await user.click(screen.getByRole("button", { name: "범위 단어장 찾기" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "배정하기" })).not.toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "단어장 검색" });
    expect(search).toHaveFocus();
    await user.type(search, "형용사{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("검색 결과 1권");
    expect(mocks.screenSubmit).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(condition).toBeVisible();
    expect(condition).toHaveValue("날짜 없이 5회차");
    expect(screen.getByRole("button", { name: "범위 단어장 찾기" })).toHaveFocus();
    expect(mocks.rangeDataset).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("현재 단어장 재선택은 초기화하지 않고 다른 단어장 확정 때만 한 번 전환한다", () => {
    mocks.useScreen.mockReturnValue({ ...screenController(), readyDatasets: datasets });
    mocks.useReview.mockReturnValue({
      ...reviewController("ready", true),
      datasetOptions: datasets.map((dataset) => ({ dataset, count: 2 })),
      draft: { datasetId: datasets[0]!.id, questionCount: 2 },
    });
    render(<VocabAssignmentPlanner data={data} onClose={vi.fn()} onSuccess={vi.fn()} selectionMode="single" students={[student]} />);
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));
    fireEvent.click(screen.getByRole("button", { name: "오답 단어장 찾기" }));
    fireEvent.click(screen.getByRole("button", { name: /심석 고1 형용사 500/ }));
    expect(mocks.reviewDataset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "오답 단어장 찾기" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "오답 단어장 찾기" }));
    fireEvent.click(screen.getByRole("button", { name: /심석 고2 영어Ⅱ/ }));
    expect(mocks.reviewDataset).toHaveBeenCalledExactlyOnceWith(datasets[1]!.id);
    expect(mocks.rangeDataset).not.toHaveBeenCalled();
  });

  it("오답 선택은 미배정 후보와 개수만 표시하며 취소는 배정창을 닫지 않는다", () => {
    mocks.useScreen.mockReturnValue({ ...screenController(), readyDatasets: datasets });
    mocks.useReview.mockReturnValue({
      ...reviewController("ready", true), datasetOptions: [{ dataset: datasets[1], count: 7 }],
    });
    const onClose = vi.fn();
    render(<VocabAssignmentPlanner data={data} onClose={onClose} onSuccess={vi.fn()} selectionMode="single" students={[student]} />);
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));
    fireEvent.click(screen.getByRole("button", { name: "오답 단어장 찾기" }));
    const list = screen.getByRole("region", { name: "단어장 목록" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(list).toHaveTextContent("미배정 오답 7개");
    expect(list).not.toHaveTextContent("형용사");
    fireEvent.click(screen.getByRole("button", { name: "선택 취소" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.reviewDataset).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "오답 시험" })).toHaveAttribute("aria-selected", "true");
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
