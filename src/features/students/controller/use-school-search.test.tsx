// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { SchoolSearchRequestError, type SchoolSearchResponse } from "../contracts/school-search-contract";
import { loadSchoolSearch } from "../transport/school-search";
import { useSchoolSearch } from "./use-school-search";
vi.mock("../transport/school-search", () => ({ loadSchoolSearch: vi.fn() }));
vi.mock("@/features/session/public-client", () => ({ announceAdminPrivateCacheChange: vi.fn() }));
const found: SchoolSearchResponse = { items: [{ id: "fake:1", name: "가짜고등학교", region: "가짜 지역" }], hasMore: false };
beforeEach(() => { vi.useFakeTimers(); vi.mocked(loadSchoolSearch).mockResolvedValue(found); });
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
function mount() {
  return renderHook(({ ownerKey, active }) => {
    const [value, setValue] = useState("기존학교");
    return { search: useSchoolSearch({ ownerKey, active, value, onChange: setValue }), setValue };
  }, { initialProps: { ownerKey: "student-a", active: true } });
}
const tick = (ms = 350) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
it("외부 학교값 교체 뒤 이전 값으로 돌아와도 취소한 검색 결과를 되살리지 않는다", async () => {
  const { result } = mount(); act(() => result.current.search.actions.change("가짜")); await tick();
  expect(result.current.search.status).toBe("ready");
  act(() => result.current.setValue("다른학교")); act(() => result.current.setValue("가짜"));
  expect(result.current.search.status).toBe("idle"); expect(result.current.search.items).toEqual([]);
});
it("기존 값 자동조회0·짧은 입력0·350ms 합치기·선택은 이름만 변경", async () => {
  const { result } = mount(); await tick(); expect(loadSchoolSearch).not.toHaveBeenCalled();
  act(() => result.current.search.actions.change("가")); await tick(); expect(loadSchoolSearch).not.toHaveBeenCalled();
  act(() => result.current.search.actions.change("가짜")); await tick(200);
  act(() => result.current.search.actions.change("가짜고")); await tick(349); expect(loadSchoolSearch).not.toHaveBeenCalled();
  await tick(1); expect(loadSchoolSearch).toHaveBeenCalledOnce(); expect(result.current.search.items).toEqual(found.items);
  expect(result.current.search.message).toBe("학교 1곳을 찾았습니다. 지역을 확인하고 선택해 주세요.");
  act(() => result.current.search.actions.choose("fake:1")); expect(result.current.search.value).toBe("가짜고등학교");
  await tick(); expect(loadSchoolSearch).toHaveBeenCalledOnce(); expect(result.current.search.items).toEqual([]);
});
it.each(["query", "owner", "close", "reset", "external"])("%s 교체 후 늦은 401은 현재 화면을 잠그지 않는다", async change => {
  let reject!: (error: Error) => void; let signal!: AbortSignal;
  vi.mocked(loadSchoolSearch).mockImplementation((_, input) => { signal = input; return new Promise((_, fail) => { reject = fail; }); });
  const { result, rerender } = mount();
  act(() => result.current.search.actions.change("가짜")); await tick();
  if (change === "query") act(() => result.current.search.actions.change("다른학교"));
  if (change === "owner") rerender({ ownerKey: "student-b", active: true });
  if (change === "close") { rerender({ ownerKey: "student-a", active: false }); rerender({ ownerKey: "student-a", active: true }); }
  if (change === "reset") act(() => { result.current.setValue(""); result.current.search.actions.reset(); });
  if (change === "external") act(() => result.current.setValue("서버최신학교"));
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new SchoolSearchRequestError(401)));
  expect(result.current.search.locked).toBe(false); expect(announceAdminPrivateCacheChange).not.toHaveBeenCalled();
  if (change !== "query") expect(result.current.search.status).toBe("idle");
});
it("이전 성공은 새 결과를 덮지 않고 실패/0건도 직접 입력을 보존한다", async () => {
  let old!: (value: SchoolSearchResponse) => void;
  vi.mocked(loadSchoolSearch).mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValueOnce({ items: [], hasMore: false });
  const { result } = mount(); act(() => result.current.search.actions.change("가짜")); await tick();
  act(() => result.current.search.actions.change("직접학교")); await tick(); await act(async () => old(found));
  expect(result.current.search.items).toEqual([]); expect(result.current.search.message).toContain("검색된 학교가 없습니다");
  expect(result.current.search.value).toBe("직접학교");
  vi.mocked(loadSchoolSearch).mockRejectedValueOnce(new Error("provider secret"));
  act(() => result.current.search.actions.retry()); await tick();
  expect(result.current.search.status).toBe("error"); expect(result.current.search.value).toBe("직접학교"); expect(result.current.search.message).not.toContain("secret");
});
it.each([401, 403])("현재 %s만 개인정보 숨김 신호를 내고 닫기/reset으로 해제되지 않는다", async status => {
  vi.mocked(loadSchoolSearch).mockRejectedValue(new SchoolSearchRequestError(status));
  const { result, rerender } = mount(); act(() => result.current.search.actions.change("가짜")); await tick();
  expect(result.current.search.locked).toBe(true); expect(announceAdminPrivateCacheChange).toHaveBeenCalledWith("identity");
  act(() => result.current.search.actions.reset()); rerender({ ownerKey: "student-a", active: false }); rerender({ ownerKey: "student-a", active: true });
  expect(result.current.search.locked).toBe(true);
});
