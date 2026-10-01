/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StableDataRegion } from "./stable-data-region";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("대기에는 직전 높이만 보존하고 이전 개인 DOM은 제거한다", () => {
  let resize: (() => void) | undefined;
  vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { resize = fn; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({height:512} as DOMRect);
  const props = { fallback: <p role="status">준비 중</p>, children: <p>개인 내용</p> };
  const { rerender, container } = render(<StableDataRegion {...props} pending={false} />);
  act(() => resize?.());
  rerender(<StableDataRegion {...props} pending />);
  expect(container.firstElementChild).toHaveStyle({minHeight:"512px"});
  expect(screen.queryByText("개인 내용")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeVisible();
  rerender(<StableDataRegion {...props} pending={false} />);
  expect(container.firstElementChild).not.toHaveStyle({minHeight:"512px"});
});
