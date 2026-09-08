// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DialogFrame, DialogHeader, DialogVisibilityBoundary } from "./dialog";
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(cleanup);
describe("대화상자 제목의 닫기 표시", () => {
  it("기본 닫기는 유지하고 명시적으로 숨겨도 제목·별도 작업·Escape를 보존한다", () => {
    const close = vi.fn();
    const view = (showCloseButton?: boolean) => <DialogFrame aria-label="작성 확인" onRequestClose={close}>
      <DialogHeader closeLabel="닫기" showCloseButton={showCloseButton} actions={<button>별도 작업</button>}>
        <h2>작성 확인</h2>
      </DialogHeader>
    </DialogFrame>;
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(close).toHaveBeenLastCalledWith("close-button");
    rerender(view(false));
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "작성 확인" })).toBeVisible();
    expect(screen.getByRole("button", { name: "별도 작업" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenLastCalledWith("escape");
  });
});
describe("대화상자 임시 표시 경계", () => {
  it("두 창을 함께 숨겼다 복원해도 입력/최상단 초점과 마지막 스크롤 해제가 맞다", async () => {
    const afterClose = vi.fn();
    const view = (editor: boolean, confirm: boolean, visible: boolean) => <><button>목록에서 열기</button>
      <DialogVisibilityBoundary visible={visible}>
        {editor ? <DialogFrame onRequestClose={vi.fn()} onAfterClose={afterClose} aria-label="배정 창"><button>배정 닫기</button></DialogFrame> : null}
        {confirm ? <DialogFrame onRequestClose={vi.fn()} onAfterClose={afterClose} aria-label="폐기 확인"><button>계속 작성</button></DialogFrame> : null}
      </DialogVisibilityBoundary></>;
    const { rerender } = render(view(false, false, true));
    const opener = screen.getByText("목록에서 열기"); opener.focus();
    rerender(view(true, false, true)); const closer = screen.getByText("배정 닫기"); closer.focus();
    rerender(view(true, true, true)); const keep = screen.getByText("계속 작성"); keep.focus();
    const dialogs = screen.getAllByRole("dialog"); expect(dialogs).toHaveLength(2);
    rerender(view(true, true, false)); expect(document.body.style.overflow).not.toBe("hidden");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(view(true, true, true)); expect(keep).toHaveFocus();
    for (const dialog of dialogs) { expect(dialog).toHaveAttribute("open"); fireEvent(dialog, new Event("close")); }
    expect(afterClose).not.toHaveBeenCalled(); expect(document.body.style.overflow).toBe("hidden");
    rerender(view(true, false, true)); await waitFor(() => expect(closer).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");
    rerender(view(false, false, true)); await waitFor(() => expect(opener).toHaveFocus());
    expect(document.body.style.overflow).not.toBe("hidden"); expect(document.documentElement.style.overflow).not.toBe("hidden");
  });
  it("요청 효과와 입력을 보존하면서 닫고 초점/스크롤을 복원한다", () => {
    const cleanupRequest = vi.fn(); const started = vi.fn(); const closed = vi.fn();
    function Editor() {
      const [value, setValue] = useState("");
      useEffect(() => { started(); return cleanupRequest; }, []);
      return <DialogFrame onRequestClose={vi.fn()} onAfterClose={closed} aria-label="작성 창">
        <input aria-label="작성 값" value={value} onChange={event => setValue(event.target.value)} />
      </DialogFrame>;
    }
    const view = (visible: boolean) => <><button>재시도</button><DialogVisibilityBoundary visible={visible}><Editor /></DialogVisibilityBoundary></>;
    const { rerender, unmount } = render(view(true));
    const input = screen.getByRole("textbox", { name: "작성 값" }); input.focus();
    fireEvent.change(input, { target: { value: "보존할 내용" } });
    const dialog = screen.getByRole("dialog", { name: "작성 창" }); expect(dialog).toHaveAttribute("open");
    rerender(view(false));
    expect(input).not.toBeVisible(); expect(dialog).not.toHaveAttribute("open"); expect(dialog).toHaveStyle({ display: "none" });
    expect(document.body.style.overflow).not.toBe("hidden"); expect(cleanupRequest).not.toHaveBeenCalled();
    fireEvent(dialog, new Event("close")); expect(closed).not.toHaveBeenCalled();
    rerender(view(true)); expect(input).toHaveValue("보존할 내용"); expect(input).toHaveFocus();
    expect(dialog).toHaveAttribute("open"); expect(started).toHaveBeenCalledTimes(1);
    unmount(); expect(cleanupRequest).toHaveBeenCalledTimes(1); expect(document.body.style.overflow).not.toBe("hidden");
  });
});
