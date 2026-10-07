// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const cache = vi.hoisted(() => ({ read: vi.fn(), rememberFilters: vi.fn(), lock: vi.fn() }));
vi.mock("./history-list-cache-provider", () => ({ useHistoryListCache: () => ({ cache }) }));
import { useAdminHistoryListController } from "./use-admin-history-list-controller";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
it("다른 조건으로 떠난 재시도는 이후 검색을 강제 갱신으로 만들지 않는다", async () => {
  vi.useFakeTimers();
  const initial={currentOnly:false,query:"A",sections:[],snapshotAt:"initial",statusFilter:"all" as const};
  cache.read.mockRejectedValueOnce(new Error("failed")).mockImplementation(async filters => ({snapshot:{...initial,...filters}}));
  const {result,rerender}=renderHook(({query})=>useAdminHistoryListController(initial,{query,statusFilter:"all"},true),{initialProps:{query:"B"}});
  await act(()=>vi.advanceTimersByTimeAsync(300));
  act(()=>result.current.retry());
  rerender({query:"A"});
  rerender({query:"B"});
  await act(()=>vi.advanceTimersByTimeAsync(300));
  expect(cache.read).toHaveBeenCalledTimes(2);
  expect(cache.read.mock.calls[1][2]).toBe(false);
});
