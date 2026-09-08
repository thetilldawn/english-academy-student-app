import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadSchoolSearch } from "./school-search";
import { schoolSearchMessages } from "../contracts/school-search-contract";
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("브라우저는 같은 출처 API에 검색어만 보내고 최소 응답만 받는다", async () => {
  fetchMock.mockResolvedValue(Response.json({ items: [], hasMore: false }));
  expect(await loadSchoolSearch(" 가짜 ", new AbortController().signal)).toEqual({ items: [], hasMore: false });
  expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/schools/search");
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", body: JSON.stringify({ query: "가짜" }) });
});
it.each([401, 403, 500])("%s 원문 오류는 화면 문구로 쓰지 않는다", async status => {
  fetchMock.mockResolvedValue(Response.json({ error: "secret internal SQL" }, { status }));
  await expect(loadSchoolSearch("가짜", new AbortController().signal)).rejects.toMatchObject({ status, message: status === 500 ? schoolSearchMessages.error : schoolSearchMessages.auth });
});
it("깨진 성공 응답은 빈 결과가 아니다", async () => {
  fetchMock.mockResolvedValue(Response.json({ items: [], hasMore: false, apiKey: "should-not-arrive" }));
  await expect(loadSchoolSearch("가짜", new AbortController().signal)).rejects.toMatchObject({ status: 503 });
});
it("응답 본문까지 시간 제한이 적용된다", async () => {
  vi.useFakeTimers(); fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
  const check = expect(loadSchoolSearch("가짜", new AbortController().signal)).rejects.toBeInstanceOf(Error);
  await vi.advanceTimersByTimeAsync(7000); await check;
});
