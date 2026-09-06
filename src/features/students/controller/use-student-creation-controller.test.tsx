// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createStudent } from "../api/student-mutations";
import { announceStudentDirectoryRefresh } from "./student-directory-events";
import { useStudentCreationController } from "./use-student-creation-controller";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../api/student-mutations", () => ({ createStudent: vi.fn() }));
vi.mock("./student-directory-events", () => ({ announceStudentDirectoryRefresh: vi.fn() }));
vi.mock("@/lib/kakao-share", () => ({ sendKakaoText: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function form() {
  const element = document.createElement("form");
  for (const [name, value] of Object.entries({ displayName: "가짜 학생", schoolName: "가짜 학교", gradeLabel: "고1", note: "가짜 메모", currentVocabDatasetId: "" })) {
    const input = document.createElement("input"); input.name = name; input.value = value; element.append(input);
  }
  return element;
}
it("기존 다섯 필드와 빈 단어장을 전송하고 성공때만 초기화/목록 갱신/코드 표시한다", async () => {
  vi.mocked(createStudent).mockResolvedValue({ code: "fake-only" } as Awaited<ReturnType<typeof createStudent>>);
  const input = form(), reset = vi.spyOn(input, "reset");
  const { result } = renderHook(() => useStudentCreationController("https://example.invalid"));
  await act(() => result.current.actions.submit(input));
  expect(createStudent).toHaveBeenCalledExactlyOnceWith({ displayName: "가짜 학생", schoolName: "가짜 학교", gradeLabel: "고1", note: "가짜 메모", currentVocabDatasetId: "" });
  expect(reset).toHaveBeenCalledOnce(); expect(announceStudentDirectoryRefresh).toHaveBeenCalledOnce();
  expect(result.current.code).toMatchObject({ code: "fake-only" });
});
it.each(["request", "missing-code"])("%s 실패는 입력 보존과 갱신0", async (kind) => {
  if (kind === "request") vi.mocked(createStudent).mockRejectedValue(new Error("학생을 만들지 못했습니다."));
  else vi.mocked(createStudent).mockResolvedValue({} as Awaited<ReturnType<typeof createStudent>>);
  const input = form(), reset = vi.spyOn(input, "reset");
  const { result } = renderHook(() => useStudentCreationController("https://example.invalid"));
  await act(() => result.current.actions.submit(input));
  expect(reset).not.toHaveBeenCalled(); expect(announceStudentDirectoryRefresh).not.toHaveBeenCalled();
  expect(new FormData(input).get("displayName")).toBe("가짜 학생");
  expect(result.current.code).toBeNull(); expect(result.current.error).not.toBe("");
});
