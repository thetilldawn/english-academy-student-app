/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderPointSummary } from "@/features/learning-points/public-ui";

const mocks = vi.hoisted(() => ({ path: "/student", router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path, useRouter: () => mocks.router }));
vi.mock("@/components/student-logout-button", () => ({ StudentLogoutButton: () => <button>접속 종료</button> }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => <button>테마 전환</button> }));
import { StudentShell } from "./student-shell";

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
