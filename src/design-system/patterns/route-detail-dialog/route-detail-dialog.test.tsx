// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RouteDetailDialog } from "./route-detail-dialog";

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
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
  it("forwards a close reason without owning App Router navigation", async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    render(
      <RouteDetailDialog
        closeLabel="상세 닫기"
        heading={<h2 id="detail-title">상세</h2>}
        onRequestClose={onRequestClose}
        titleId="detail-title"
      >
        상세 내용
      </RouteDetailDialog>,
    );

    await user.click(screen.getByRole("button", { name: "상세 닫기" }));

    expect(onRequestClose).toHaveBeenCalledWith("close-button");
  });

  it("keeps a guarded edit open", async () => {
    const user = userEvent.setup();
    const beforeRouteClose = vi.fn(() => false);
    const onRequestClose = vi.fn();
    render(
      <RouteDetailDialog
        beforeRouteClose={beforeRouteClose}
        closeLabel="닫기"
        heading={<h2 id="detail-title">상세</h2>}
        onRequestClose={onRequestClose}
        titleId="detail-title"
      >
        편집 양식
      </RouteDetailDialog>,
    );

    await user.click(screen.getByRole("button", { name: "닫기" }));

    expect(beforeRouteClose).toHaveBeenCalledWith("close-button");
    expect(onRequestClose).not.toHaveBeenCalled();
  });
});
