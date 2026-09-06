// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssignmentWorkspaceReadError, loadAssignmentDatasetDirectory } from "@/features/assignments/public-client";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import { adminStudentsText as copy } from "@/content/ko/admin-students";
import { StudentCreateWorkspace } from "./student-create-workspace";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), code: null as null | { code: string; label: string } }));
vi.mock("@/features/assignments/public-client", async (original) => ({ ...await original<typeof import("@/features/assignments/public-client")>(), loadAssignmentDatasetDirectory: vi.fn() }));
vi.mock("../controller/use-student-creation-controller", () => ({ useStudentCreationController: () => ({
  busy: false, error: "", code: mocks.code, actions: { submit: mocks.submit, closeCode: vi.fn(), copyCode: vi.fn(), shareCode: vi.fn() },
}) }));
beforeEach(() => {
  mocks.code = null;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function toggle(container: HTMLElement, open: boolean) {
  const details = container.querySelector("details")!;
  act(() => { details.open = open; fireEvent(details, new Event("toggle")); });
}
it("첫 열기 준비 뒤 작성한 모든 입력과 선택을 접었다 펴도 보존한다", async () => {
  const dataset = cataloguedDatasetFromMetadata({ id: "fake-book", title: "가짜 단어장" }, undefined);
  vi.mocked(loadAssignmentDatasetDirectory).mockResolvedValue({ datasets: [dataset] });
  const { container } = render(<StudentCreateWorkspace appOrigin="https://example.invalid" />);
  expect(loadAssignmentDatasetDirectory).not.toHaveBeenCalled();
  expect(screen.queryByText(copy.createStudent.noWordbookNotice)).not.toBeInTheDocument();
  const form = container.querySelector("form")!;
  fireEvent.submit(form); expect(mocks.submit).not.toHaveBeenCalled();
  toggle(container, true);
  await waitFor(() => expect(screen.getByRole("button", { name: copy.createStudent.submit })).toBeEnabled());
  const fields = ["displayName", "schoolName", "gradeLabel", "note", "currentVocabDatasetId"];
  const values = ["가짜 학생", "가짜 학교", "고1", "입력 보존", "fake-book"];
  fields.forEach((name, i) => fireEvent.change(form.querySelector(`[name="${name}"]`)!, { target: { value: values[i] } }));
  toggle(container, false); toggle(container, true);
  fields.forEach((name, i) => expect(form.elements.namedItem(name)).toHaveValue(values[i]));
  expect(loadAssignmentDatasetDirectory).toHaveBeenCalledOnce();
  fireEvent.submit(form); expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(form);
});
it("대기/실패는 0개 안내로 바꾸지 않고 직접 제출도 차단하며 재시도한다", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(loadAssignmentDatasetDirectory).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
    .mockResolvedValueOnce({ datasets: [] });
  const { container } = render(<StudentCreateWorkspace appOrigin="https://example.invalid" />);
  toggle(container, true);
  expect(screen.getByRole("status")).toHaveTextContent(copy.createStudent.preparationLoading);
  const form = container.querySelector("form")!;
  fireEvent.change(form.querySelector('[name="displayName"]')!, { target: { value: "보존 학생" } });
  fireEvent.submit(form); expect(mocks.submit).not.toHaveBeenCalled();
  await act(async () => reject(new Error("SQL internal secret")));
  expect(screen.getByRole("alert")).toHaveTextContent(copy.createStudent.preparationError);
  expect(screen.queryByText(/SQL internal/)).not.toBeInTheDocument();
  expect(screen.queryByText(copy.createStudent.noWordbookNotice)).not.toBeInTheDocument();
  fireEvent.submit(form); expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: copy.page.retry }));
  await waitFor(() => expect(screen.getByText(copy.createStudent.noWordbookNotice)).toBeVisible());
  expect(form.elements.namedItem("displayName")).toHaveValue("보존 학생");
});
it.each([401, 403])("권한 %s 실패면 등록폼과 영역 밖 접속코드도 숨긴다", async (status) => {
  mocks.code = { code: "fake-code-only", label: "가짜 접속 코드" };
  vi.mocked(loadAssignmentDatasetDirectory).mockRejectedValue(new AssignmentWorkspaceReadError(status, "internal"));
  const { container } = render(<StudentCreateWorkspace appOrigin="https://example.invalid" />);
  toggle(container, true);
  await waitFor(() => expect(screen.getByText(copy.createStudent.preparationAuthError)).toBeVisible());
  expect(container.querySelector("form")).toBeNull();
  expect(screen.queryByText("fake-code-only")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: copy.createStudent.preparationLogin })).toHaveAttribute("href", "/admin/login");
});
