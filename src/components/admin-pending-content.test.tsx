// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pathname: "/admin/students" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ refresh: vi.fn() }) }));
import { AdminPendingContent } from "./admin-pending-content";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each(["/admin/students", "/admin/assignments", "/admin/results"])("인증 대기 %s에서 검색은 표시하되 개인 조회는 하지 않는다", async pathname => {
  state.pathname = pathname; const read = vi.fn(); vi.stubGlobal("fetch", read);
  render(<AdminPendingContent />);
  expect(screen.getByRole("searchbox")).toBeDisabled();
  await act(async () => {}); expect(read).not.toHaveBeenCalled();
});
