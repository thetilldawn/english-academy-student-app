// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoutedDetailDialog } from "./routed-detail-dialog";

const { back } = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back }),
}));

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  back.mockReset();
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

describe("RoutedDetailDialog", () => {
  it("navigates back once for a real Escape key", async () => {
    const user = userEvent.setup();
    render(
      <RoutedDetailDialog
        closeLabel="상세 닫기"
        heading={<h2 id="escape-detail-title">상세</h2>}
        titleId="escape-detail-title"
      >
        상세 내용
      </RoutedDetailDialog>,
    );

    screen.getByRole("button", { name: "상세 닫기" }).focus();
    await user.keyboard("{Escape}");

    expect(back).toHaveBeenCalledOnce();
  });

  it("deduplicates close signals before navigating back", async () => {
    const user = userEvent.setup();
    render(
      <RoutedDetailDialog
        closeLabel="상세 닫기"
        heading={<h2 id="detail-title">상세</h2>}
        titleId="detail-title"
      >
        상세 내용
      </RoutedDetailDialog>,
    );

    const button = screen.getByRole("button", { name: "상세 닫기" });
    await user.dblClick(button);

    expect(back).toHaveBeenCalledOnce();
  });

  it("route guard가 허용할 때만 실제 뒤로가기를 실행한다", async () => {
    const user = userEvent.setup();
    const routeCloseGuard = vi.fn();
    render(
      <RoutedDetailDialog
        closeLabel="상세 닫기"
        heading={<h2 id="guarded-detail-title">상세</h2>}
        routeCloseGuard={routeCloseGuard}
        titleId="guarded-detail-title"
      >
        상세 내용
      </RoutedDetailDialog>,
    );

    await user.click(screen.getByRole("button", { name: "상세 닫기" }));
    expect(back).not.toHaveBeenCalled();
    const closeRoute = routeCloseGuard.mock.calls[0]?.[0] as (() => void);
    closeRoute();
    expect(back).toHaveBeenCalledOnce();
  });

  it("승인된 route guard가 이동을 준비하는 동안 닫기 신호를 중복 전달하지 않는다", async () => {
    const user = userEvent.setup();
    const routeCloseGuard = vi.fn(() => true);
    render(
      <RoutedDetailDialog
        closeLabel="상세 닫기"
        heading={<h2 id="locked-detail-title">상세</h2>}
        routeCloseGuard={routeCloseGuard}
        titleId="locked-detail-title"
      >
        상세 내용
      </RoutedDetailDialog>,
    );

    await user.dblClick(screen.getByRole("button", { name: "상세 닫기" }));
    expect(routeCloseGuard).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
  });
});
