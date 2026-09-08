// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installNativeOverlayFixture } from "@/test-support/native-overlay-fixture";
import { ConfirmationProvider, useConfirmation } from "./confirmation";
import { DialogBody, DialogFrame } from "../../primitives/dialog/dialog";

installNativeOverlayFixture();
afterEach(cleanup);

describe("one owned confirmation", () => {
  it.each([false, true])("resolves exactly once after a visible decision (%s)", async accepted => {
    const { result } = renderHook(() => useConfirmation(), { wrapper: ConfirmationProvider });
    let outcome: Promise<boolean>;
    act(() => { outcome = result.current({ message: "입력 내용을 버릴까요?" }); });
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("입력 내용을 버릴까요?");
    expect(await result.current({ message: "중복" })).toBe(false);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    act(() => fireEvent.click(screen.getByRole("button", { name: accepted ? "확인" : "취소" })));
    expect(await outcome!).toBe(accepted);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancels when its owner changes or its signal aborts", async () => {
    const { result, rerender } = renderHook(({ owner }) => useConfirmation(owner), { initialProps: { owner: "A" }, wrapper: ConfirmationProvider });
    let first: Promise<boolean>, second: Promise<boolean>;
    act(() => { first = result.current({ message: "학생 A 작업" }); });
    rerender({ owner: "B" });
    expect(await first!).toBe(false);
    const abort = new AbortController();
    act(() => { second = result.current({ message: "학생 B 작업", signal: abort.signal }); });
    act(() => abort.abort());
    expect(await second!).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves false if the provider unmounts", async () => {
    const { result, unmount } = renderHook(() => useConfirmation(), { wrapper: ConfirmationProvider });
    let pending: Promise<boolean>;
    act(() => { pending = result.current({ message: "취소 대상" }); });
    unmount();
    expect(await pending!).toBe(false);
  });

  it("Escape closes only the top dialog and retains the underlying editor", async () => {
    const closed = vi.fn();
    function Editor() {
      const confirm = useConfirmation();
      return <DialogFrame aria-label="작성 창" onRequestClose={closed}><DialogBody>
        <input aria-label="초안" defaultValue="보존할 값" />
        <button onClick={() => void confirm({ message: "작성을 그만둘까요?" })}>질문</button>
      </DialogBody></DialogFrame>;
    }
    render(<ConfirmationProvider><Editor /></ConfirmationProvider>);
    const trigger = screen.getByRole("button", { name: "질문" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole("button", { name: "취소" }), { key: "Escape" });
    await act(async () => {});
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "초안" })).toHaveValue("보존할 값");
    expect(closed).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
  });
});
