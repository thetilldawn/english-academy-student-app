// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStudentWrongWordCache } from "../../controller/use-student-wrong-word-cache";
import { fakeId, fakeMistakePage } from "../../controller/mistake-test-fixtures";
import { cancelStudentReviewDraft, createStudentWorksheetRequest, loadStudentMistakes, queueStudentMistakes, WrongWordRequestError } from "../../api/wrong-word-transport";
import { StudentWrongWordPanel } from "./student-wrong-word-panel";
vi.mock("../../api/wrong-word-transport", async original => ({ ...await original<typeof import("../../api/wrong-word-transport")>(),
  loadStudentMistakes: vi.fn(), queueStudentMistakes: vi.fn(), createStudentWorksheetRequest: vi.fn(), cancelStudentReviewDraft: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function Host() {
  const cache = useStudentWrongWordCache(fakeId(1));
  return <StudentWrongWordPanel active cachedAt={cache.entry?.loadedAt ?? null} cachedHistory={cache.entry?.history ?? null}
    studentId={fakeId(1)} onLoaded={cache.actions.cache} />;
}
it("검색 대기·실패 중에도 입력창과 포커스를 유지하고 옛 목록은 선택하지 못한다", async () => {
  vi.mocked(loadStudentMistakes).mockResolvedValueOnce(fakeMistakePage()).mockRejectedValueOnce(new WrongWordRequestError("조건을 다시 확인해 주세요.", 400));
  render(<Host />); await screen.findByText("fakeword1");
  const input = screen.getByRole("searchbox"); input.focus();
  fireEvent.change(input, { target: { value: "x".repeat(201) } });
  expect(screen.getByRole("searchbox")).toBe(input); expect(document.activeElement).toBe(input);
  expect(screen.queryByText("fakeword1")).toBeNull();
  await screen.findByText("조건을 다시 확인해 주세요.");
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toHaveLength(201);
});
it.each(["queue", "worksheet", "cancel"] as const)("%s 변경 요청에서 권한이 거절되면 개인 표시와 선택을 즉시 숨긴다", async action => {
  const page = fakeMistakePage();
  if (action === "cancel") page.reviewDrafts = [{ draftId: fakeId(20), datasetId: fakeId(10), questionCount: 1 }];
  vi.mocked(loadStudentMistakes).mockResolvedValue(page);
  vi.mocked(queueStudentMistakes).mockRejectedValue(new WrongWordRequestError("권한 없음", 403));
  vi.mocked(createStudentWorksheetRequest).mockRejectedValue(new WrongWordRequestError("권한 없음", 403));
  vi.mocked(cancelStudentReviewDraft).mockRejectedValue(new WrongWordRequestError("권한 없음", 403));
  render(<Host />); await screen.findByText("fakeword1");
  if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "재시험 준비 취소" }));
  else {
    if (action === "worksheet") fireEvent.click(screen.getByRole("button", { name: "해석 시험지 범위" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: action === "queue" ? "다음 시험에 추가" : "해석 시험지 범위 업데이트" }));
  }
  await screen.findByText("관리자 로그인을 다시 확인해 주세요.");
  expect(screen.queryByText("fakeword1")).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
  expect(loadStudentMistakes).toHaveBeenCalledTimes(1);
});
it("취소 요청의 응답을 잃으면 목록을 다시 확인해 이미 취소된 준비를 제거한다", async () => {
  vi.mocked(loadStudentMistakes).mockResolvedValueOnce({ ...fakeMistakePage(), reviewDrafts: [{ draftId: fakeId(20), datasetId: fakeId(10), questionCount: 1 }] })
    .mockResolvedValueOnce(fakeMistakePage());
  vi.mocked(cancelStudentReviewDraft).mockRejectedValue(new TypeError("응답 유실"));
  render(<Host />); fireEvent.click(await screen.findByRole("button", { name: "재시험 준비 취소" }));
  await waitFor(() => expect(loadStudentMistakes).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("button", { name: "재시험 준비 취소" })).toBeNull());
});
