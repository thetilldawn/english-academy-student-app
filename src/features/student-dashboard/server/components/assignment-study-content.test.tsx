/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { studentAppText } from "@/content/ko/student-app";
const mocks = vi.hoisted(() => ({
  session: vi.fn(), study: vi.fn(), back: vi.fn(), refresh: vi.fn(), reader: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/student-session", () => ({ requireStudentSession: mocks.session }));
vi.mock("../queries/assignment-study-query", () => ({ getAssignmentStudy: mocks.study }));
vi.mock("../../client/components/assignment-study-reader", () => ({
  AssignmentStudyReader: (props: unknown) => { mocks.reader(props); return <p>허용된 학습 자료</p>; },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mocks.back, refresh: mocks.refresh }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
import { AssignmentStudyContent } from "./assignment-study-content";
const originalShow = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ studentId: "fake-student" });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShow;
  HTMLDialogElement.prototype.close = originalClose;
});
const props = (presentation: "page" | "dialog") => ({ presentation, params: Promise.resolve({ id: "fake-assignment" }) });
const locked = (state: "held" | "waiting_initial" | "waiting_time", opensAt: string | null = null) => ({
  assignmentId: "fake-assignment", title: "다음 단어 시험", mode: "book_meaning_choice",
  release: { state, opensAt, hasDeadline: false },
});

describe("잠긴 단어장 서버 조립", () => {
  it.each(["page", "dialog"] as const)("%s에서도 자료 없이 쉬운 보류 안내와 닫기를 유지한다", async (presentation) => {
    mocks.study.mockResolvedValue(locked("held"));
    render(await AssignmentStudyContent(props(presentation)));
    expect(screen.getByRole("heading", { name: "다음 단어 시험" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(studentAppText.dashboard.release.held);
    expect(mocks.reader).not.toHaveBeenCalled();
    if (presentation === "page") {
      expect(screen.getByRole("link", { name: studentAppText.study.close })).toHaveAttribute("href", "/student");
    } else {
      fireEvent.click(screen.getByRole("button", { name: studentAppText.study.close }));
      expect(mocks.back).toHaveBeenCalledOnce();
    }
  });
  it("첫 시험 대기는 반복 요청 없이 기다리고 확정 공개 시각만 한 번 갱신한다", async () => {
    vi.useFakeTimers();
    mocks.study.mockResolvedValue(locked("waiting_initial"));
    const view = render(await AssignmentStudyContent(props("page")));
    await act(async () => { await vi.advanceTimersByTimeAsync(3600000); });
    expect(mocks.refresh).not.toHaveBeenCalled();
    view.unmount();
    mocks.study.mockResolvedValue(locked("waiting_time", new Date(Date.now() + 1000).toISOString()));
    render(await AssignmentStudyContent(props("page")));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.reader).not.toHaveBeenCalled();
  });
  it("진짜 없는 배정만 404로 보내고 조회 실패를 빈 결과로 바꾸지 않는다", async () => {
    mocks.study.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("안전한 조회 오류"));
    await expect(AssignmentStudyContent(props("page"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AssignmentStudyContent(props("dialog"))).rejects.toThrow("안전한 조회 오류");
    expect(mocks.reader).not.toHaveBeenCalled();
  });
  it("인증 실패에는 개인 자료를 조회하지 않는다", async () => {
    mocks.session.mockRejectedValueOnce(new Error("LOGIN_REDIRECT"));
    await expect(AssignmentStudyContent(props("dialog"))).rejects.toThrow("LOGIN_REDIRECT");
    expect(mocks.study).not.toHaveBeenCalled();
  });
});
