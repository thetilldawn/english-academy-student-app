// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminHistoryText } from "@/content/ko/admin-history";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  NavigationExitGuardProvider,
  useGuardedNavigationRequest,
} from "@/components/navigation-exit-guard";
import type { AssignmentManagerData } from "@/lib/admin/assignment-manager-data";
import type { AdminHistoryDetail } from "../model";

import { EditableHistoryDetailDialog } from "./editable-history-detail-dialog";

const router = vi.hoisted(() => ({
  back: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("./history-assignment-editor-model", () => ({
  buildHistoryAssignmentEditorModel: () => ({ editor: true }),
}));

vi.mock("./history-detail-header", () => ({
  HistoryDetailHeader: ({ titleId }: { titleId: string }) => (
    <h2 id={titleId}>시험 상세</h2>
  ),
}));

vi.mock("./admin-history-detail", () => ({
  AdminHistoryDetailContent: ({ actions }: { actions: React.ReactNode }) => (
    <>
      <div>상세 본문</div>
      {actions}
    </>
  ),
}));

vi.mock("./history-detail-actions", () => ({
  HistoryDetailActions: ({
    editButtonRef,
    onEditRequested,
  }: {
    editButtonRef?: React.Ref<HTMLButtonElement>;
    onEditRequested: () => void;
  }) => (
    <button onClick={onEditRequested} ref={editButtonRef}>
      배정 수정 열기
    </button>
  ),
}));

vi.mock("@/features/assignments/ui/single-assignment-editor", () => ({
  SingleAssignmentEditor: ({
    formId,
    onBusyChange,
    onSubmitPresentationChange,
    onSucceeded,
  }: {
    formId: string;
    onBusyChange: (busy: boolean) => void;
    onSubmitPresentationChange: (presentation: {
      blockedReason: string | null;
      canSubmit: boolean;
      dirty: boolean;
      formId: string;
      label: string;
    }) => void;
    onSucceeded: (result: {
      idempotent: boolean;
      replacementAssignmentId: string;
      replacementPurpose: "regular";
      sourceAssignmentId: string;
      status: "replaced";
      studentId: string;
    }) => void;
  }) => {
    useEffect(() => {
      onSubmitPresentationChange({
        blockedReason: "범위 선택",
        canSubmit: false,
        dirty: false,
        formId,
        label: "변경 저장",
      });
    }, [formId, onSubmitPresentationChange]);
    return (
      <>
        <form id={formId}>
          편집 양식
          <button
            onClick={() =>
              onSubmitPresentationChange({
                blockedReason: null,
                canSubmit: true,
                dirty: true,
                formId,
                label: "변경 저장",
              })
            }
            type="button"
          >
            내용 변경
          </button>
          <button onClick={() => onBusyChange(true)} type="button">
            저장 시작
          </button>
          <button
            onClick={() => {
              onBusyChange(false);
              onSucceeded({
                idempotent: false,
                replacementAssignmentId:
                  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                replacementPurpose: "regular",
                sourceAssignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                status: "replaced",
                studentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              });
            }}
            type="button"
          >
            저장 완료
          </button>
        </form>
        <div data-testid="edit-footer">
          <span data-testid="edit-footer-error">범위 선택</span>
          <button disabled form={formId} type="submit">
            {adminLearningText.assignmentModal.submit.headerSaveChanges}
          </button>
        </div>
      </>
    );
  },
}));

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  Object.values(router).forEach((mock) => mock.mockReset());
  window.history.replaceState({}, "", "/admin/results/assignment.test.student");
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

const detail = {
  pointSummary: null,
  summary: {
    assignmentId: "assignment-1",
    studentId: "student-1",
    studentName: "미리보기 학생",
  },
} as unknown as AdminHistoryDetail;

function renderDialog() {
  return render(
    <NavigationExitGuardProvider>
      <EditableHistoryDetailDialog
        detail={detail}
        editorData={{} as AssignmentManagerData}
      />
      <NavigationProbe />
    </NavigationExitGuardProvider>,
  );
}

function NavigationProbe() {
  const requestNavigation = useGuardedNavigationRequest();
  return (
    <button
      onClick={() => {
        if (requestNavigation(() => router.replace("/admin"))) return;
        router.replace("/admin");
      }}
      type="button"
    >
      관리자 메뉴 이동
    </button>
  );
}

function releaseRouteGuardSentinel() {
  const state = { ...(window.history.state as Record<string, unknown>) };
  delete state.__routeExitGuardSentinel;
  window.history.replaceState(state, "", window.location.href);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

describe("editable history detail dialog", () => {
  it("replaces the detail body and closes the whole route dialog", async () => {
    const user = userEvent.setup();
    renderDialog();

    const editButton = screen.getByRole("button", { name: "배정 수정 열기" });
    await user.click(editButton);

    expect(screen.queryByText("상세 본문")).not.toBeInTheDocument();
    expect(screen.getByText("편집 양식")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: adminLearningText.assignmentModal.header.editTitle,
      }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", {
        name: adminLearningText.assignmentModal.submit.headerSaveChanges,
      }),
    ).toBeDisabled();
    const footer = screen.getByTestId("edit-footer");
    const footerError = screen.getByTestId("edit-footer-error");
    const footerSave = screen.getByRole("button", {
      name: adminLearningText.assignmentModal.submit.headerSaveChanges,
    });
    expect(footerError).toHaveTextContent("범위 선택");
    expect(
      footerError.compareDocumentPosition(footerSave) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(footer).toContainElement(footerSave);
    expect(
      screen.getAllByRole("button", {
        name: adminHistoryText.detailModal.close,
      }),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", {
        name: adminHistoryText.detailModal.close,
      }),
    );

    expect(router.back).toHaveBeenCalledOnce();
  });

  it("blocks every close path while saving and restores the detail after success", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "배정 수정 열기" }));
    await user.click(screen.getByRole("button", { name: "저장 시작" }));

    const dialog = screen.getByRole("dialog");
    const closeButton = screen.getByRole("button", {
      name: adminHistoryText.detailModal.close,
    });
    expect(closeButton).toBeDisabled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(screen.getByText("편집 양식")).toBeInTheDocument();
    expect(router.back).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "저장 완료" }));

    expect(screen.getByText("상세 본문")).toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith(
      "/admin/results/assignment.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      { scroll: false },
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("asks before discarding changed edit values", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog();
    await user.click(screen.getByRole("button", { name: "배정 수정 열기" }));
    await user.click(screen.getByRole("button", { name: "내용 변경" }));
    await user.click(
      screen.getByRole("button", { name: adminHistoryText.detailModal.close }),
    );

    expect(confirm).toHaveBeenCalledWith("입력한 변경 내용을 버리고 이동할까요?");
    expect(screen.getByText("편집 양식")).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(
      screen.getByRole("button", { name: adminHistoryText.detailModal.close }),
    );
    if (router.back.mock.calls.length === 0) act(releaseRouteGuardSentinel);
    await waitFor(() => expect(router.back).toHaveBeenCalledOnce());
  });

  it("warns before reloading while changed edit values remain", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "배정 수정 열기" }));

    const unchangedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unchangedEvent);
    expect(unchangedEvent.defaultPrevented).toBe(false);

    await user.click(screen.getByRole("button", { name: "내용 변경" }));
    const changedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(changedEvent);
    expect(changedEvent.defaultPrevented).toBe(true);

    await user.click(screen.getByRole("button", { name: "저장 완료" }));
    if (router.replace.mock.calls.length === 0) act(releaseRouteGuardSentinel);
    await waitFor(() => expect(router.replace).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("상세 본문")).toBeInTheDocument());
    const completedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(completedEvent);
    expect(completedEvent.defaultPrevented).toBe(false);
  });

  it("관리자 공용 이동도 같은 변경 확인을 거친다", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog();
    await user.click(screen.getByRole("button", { name: "배정 수정 열기" }));
    await user.click(screen.getByRole("button", { name: "내용 변경" }));
    confirm.mockClear();

    await user.click(screen.getByRole("button", { name: "관리자 메뉴 이동" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "관리자 메뉴 이동" }));
    if (router.replace.mock.calls.length === 0) act(releaseRouteGuardSentinel);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/admin"));
  });

  it("저장 중인 편집은 확인창 없이 관리자 공용 이동을 막는다", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    renderDialog();
    await user.click(screen.getByRole("button", { name: "배정 수정 열기" }));
    await user.click(screen.getByRole("button", { name: "저장 시작" }));
    confirm.mockClear();

    await user.click(screen.getByRole("button", { name: "관리자 메뉴 이동" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
