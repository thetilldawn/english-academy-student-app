// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AssignmentAuthenticationBoundary, useAssignmentAuthenticationFailure } from "./assignment-authentication-boundary";
import { useVocabTimeTemplates } from "./use-vocab-time-templates";
import type { AssignmentTransportResponse } from "../transport/assignment-transport";
afterEach(cleanup);

it("현재 인증 실패만 전달하고 일반 실패/해제된 요청/다른 소유자는 잠그지 않는다", () => {
  const first = vi.fn(), second = vi.fn();
  const wrapper = ({ children, onFailure }: { children: ReactNode; onFailure?: () => void }) =>
    <AssignmentAuthenticationBoundary onFailure={onFailure}>{children}</AssignmentAuthenticationBoundary>;
  let owner = first;
  const hook = renderHook(useAssignmentAuthenticationFailure, { wrapper: ({ children }) => wrapper({ children, onFailure: owner }) });
  const current = hook.result.current();
  current({ status: 503 }); expect(first).not.toHaveBeenCalled();
  current({ status: 401 }); current({ kind: "forbidden" }); expect(first).toHaveBeenCalledTimes(2);
  owner = second; hook.rerender();
  current({ status: 403 }); expect(second).not.toHaveBeenCalled(); expect(first).toHaveBeenCalledTimes(2);
  const replacement = hook.result.current(); replacement({ status: 403 }); expect(second).toHaveBeenCalledTimes(1);
  hook.unmount(); replacement({ status: 401 }); expect(second).toHaveBeenCalledTimes(1);
});

it("Strict Mode 이전 Effect 세대의 실패를 새 세대에 적용하지 않는다", () => {
  const onFailure = vi.fn(), reporters: ((value: unknown) => void)[] = [];
  renderHook(() => {
    const capture = useAssignmentAuthenticationFailure();
    useEffect(() => { reporters.push(capture()); }, [capture]);
  }, { reactStrictMode: true, wrapper: ({ children }) => <AssignmentAuthenticationBoundary onFailure={onFailure}>{children}</AssignmentAuthenticationBoundary> });
  expect(reporters).toHaveLength(2);
  reporters[0]!({ status: 401 }); expect(onFailure).not.toHaveBeenCalled();
  reporters[1]!({ status: 401 }); expect(onFailure).toHaveBeenCalledTimes(1);
});

it.each([false, true])("시간 양식 저장은 요청을 취소하지 않고 살아 있는 창만 잠근다: 해제=%s", async unmount => {
  const onFailure = vi.fn();
  let finish!: (value: AssignmentTransportResponse) => void;
  const transport = vi.fn(() => new Promise<AssignmentTransportResponse>(resolve => { finish = resolve; }));
  const hook = renderHook(() => useVocabTimeTemplates({
    initialTemplates: [], schedule: { startDate: "2026-09-06", weekdays: [1], availableTime: "18:00", deadlineDayOffset: 1, deadlineTime: "22:00" },
    timing: { mode: "total", totalSeconds: 300 }, transport,
  }), { wrapper: ({ children }) => <AssignmentAuthenticationBoundary onFailure={onFailure}>{children}</AssignmentAuthenticationBoundary> });
  let saving!: ReturnType<typeof hook.result.current.saveCurrentTemplate>;
  act(() => { saving = hook.result.current.saveCurrentTemplate("가짜 양식"); });
  if (unmount) hook.unmount();
  await act(async () => { finish({ ok: false, status: 401, data: {} }); await saving; });
  expect(transport).toHaveBeenCalledTimes(1); expect(onFailure).toHaveBeenCalledTimes(unmount ? 0 : 1);
});
