/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderPointSummary } from "@/features/learning-points/public-ui";

const mocks = vi.hoisted(() => ({ path: "/student", router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path, useRouter: () => mocks.router }));
vi.mock("@/components/student-logout-button", () => ({ StudentLogoutButton: () => <button>접속 종료</button> }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => <button>테마 전환</button> }));
import { StudentShell, StudentShellPending } from "./student-shell";

beforeEach(() => {
  mocks.path = "/student";
  mocks.router.refresh.mockReset();
  window.history.replaceState(null, "", "/student");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function shell(points = 12, gradeLabel: string | null = "고1") {
  return <StudentShell displayName="가상 검증 학생 이름이 아주 긴 경우" gradeLabel={gradeLabel}
    points={<HeaderPointSummary currentPoints={points} />}><main>시험 목록</main></StudentShell>;
}

describe("StudentShell header", () => {
  it.each(["/student/wordbook", "/student/wordbook/fake-word"])("%s는 정상·대기·실패에서도 메인 이동을 제공한다", path => {
    mocks.path = path;
    const { rerender } = render(shell());
    expect(screen.getByRole("link", { name: "메인으로" })).toHaveAttribute("href", "/student");
    rerender(<StudentShellPending />);
    expect(screen.getByRole("link", { name: "메인으로" })).toHaveAttribute("href", "/student");
    rerender(<StudentShell displayName="가짜 학생" gradeLabel={null} points={null}><p role="alert">단어를 불러오지 못했습니다.</p></StudentShell>);
    expect(screen.getByRole("link", { name: "메인으로" })).toHaveAttribute("href", "/student");
  });
  it("로그인 확인 중에도 메뉴 틀만 유지하고 개인정보와 조회효과는 마운트하지 않는다", () => {
    render(<StudentShellPending />);
    expect(screen.getByRole("banner")).toBeVisible();
    expect(screen.getByRole("button", { name: "내 단어장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "접속 종료" })).toBeDisabled();
    expect(within(screen.getByRole("banner")).getByRole("status")).toHaveAttribute("data-header-points", "loading");
    expect(screen.queryByText(/가상 검증 학생/)).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });
  it("시험 주소 대기에는 학생 머리글 없이 시험 준비만 표시한다", () => {
    mocks.path = "/student/attempt/fake"; render(<StudentShellPending />);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.getByText("시험 준비 중")).toBeVisible();
  });
  it("학교와 학년을 학생 정보 옆에 함께 표시한다", () => {
    render(<StudentShell displayName="가짜 학생" schoolName="검사 고등학교" gradeLabel="고2" points={<span>포인트 0</span>}><main>목록</main></StudentShell>);
    expect(screen.getByRole("banner")).toHaveTextContent("가짜 학생 · 검사 고등학교 · 고2");
  });
  it("keeps student information, separator, points and both controls in the common header", () => {
    render(shell(12345));
    expect(screen.getByRole("banner")).toHaveTextContent("가상 검증 학생 이름이 아주 긴 경우 · 고1|포인트12,345");
    expect(screen.getByRole("button", { name: "접속 종료" })).toBeVisible();
    expect(screen.getByRole("button", { name: "테마 전환" })).toBeVisible();
    expect(screen.getByRole("main")).not.toHaveTextContent("포인트");
  });

  it("accepts refreshed server points on result/study navigation without refreshing the whole page", () => {
    const { rerender } = render(shell());
    mocks.path = "/student/result/fake-result";
    rerender(shell(31, null));
    expect(screen.getByRole("status")).toHaveTextContent("31");
    expect(screen.getByRole("banner")).not.toHaveTextContent("·");
    mocks.path = "/student/assignments/fake/words";
    rerender(shell(31));
    expect(screen.getByRole("status")).toHaveTextContent("31");
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });

  it("hides the whole header during a focused attempt and restores it on return", () => {
    const { rerender } = render(shell());
    mocks.path = "/student/attempt/fake";
    rerender(shell());
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeVisible();
    mocks.path = "/student/result/fake";
    rerender(shell(42));
    expect(screen.getByRole("status")).toHaveTextContent("42");
  });

  it("refreshes once after history restoration commits, not before or again on rerender", () => {
    mocks.path = "/student/result/fake";
    const { rerender } = render(shell());
    act(() => {
      window.history.replaceState(null, "", "/student");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    mocks.path = "/student";
    rerender(shell(31));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    rerender(shell(32));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
  });

  it("never history-refreshes an in-progress quiz", () => {
    const { rerender } = render(shell());
    act(() => {
      window.history.replaceState(null, "", "/student/attempt/fake");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    mocks.path = "/student/attempt/fake";
    rerender(shell());
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });

  it("preserves the underlying completed-list snapshot when closing a study modal", () => {
    mocks.path = "/student/assignments/fake/words";
    const { rerender } = render(shell());
    act(() => {
      window.history.replaceState(null, "", "/student");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    mocks.path = "/student";
    rerender(shell());
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });

  it("refreshes only restored BFCache pages and cleans up listeners", () => {
    const { unmount } = render(shell());
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    unmount();
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
  });

  it("keeps sticky study titles below the actual wrapped header height", () => {
    let onResize: (() => void) | undefined;
    let height = 93;
    const disconnect = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { onResize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const { unmount } = render(shell());
    const root = screen.getByRole("banner").parentElement!;
    expect(root.style.getPropertyValue("--student-topbar-offset")).toBe("93px");
    height = 141;
    act(() => onResize?.());
    expect(root.style.getPropertyValue("--student-topbar-offset")).toBe("141px");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
