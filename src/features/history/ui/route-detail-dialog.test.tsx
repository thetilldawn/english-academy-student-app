// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminHistoryText } from "@/content/ko/admin-history";

import { RouteDetailDialog } from "./route-detail-dialog";

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

describe("RouteDetailDialog", () => {
  it("routes every close signal through a single back navigation", async () => {
    const user = userEvent.setup();
    render(
      <RouteDetailDialog heading={<h2 id="route-history-detail-title">상세</h2>}>
        상세 내용
      </RouteDetailDialog>,
    );

    const dialog = screen.getByRole("dialog");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);

    expect(back).toHaveBeenCalledOnce();
  });

  it("can keep the route open and delegate close to an editor state", async () => {
    const user = userEvent.setup();
    const closeEditor = vi.fn();
    render(
      <RouteDetailDialog
        heading={<h2 id="route-history-detail-title">상세</h2>}
        headerActions={<button type="button">변경 저장</button>}
        onRequestClose={closeEditor}
      >
        편집 양식
      </RouteDetailDialog>,
    );

    expect(screen.getByRole("button", { name: "변경 저장" })).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: adminHistoryText.detailModal.close,
      }),
    );

    expect(closeEditor).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
  });
});
