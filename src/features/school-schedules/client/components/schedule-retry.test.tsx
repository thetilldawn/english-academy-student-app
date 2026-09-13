// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { ScheduleRetry } from "./schedule-retry";
afterEach(() => { cleanup(); refresh.mockReset(); });
it("조회 실패 재시도는 자동 실행하지 않고 클릭할 때 한 번만 갱신한다", () => {
  render(<ScheduleRetry />);
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(refresh).toHaveBeenCalledTimes(1);
});
