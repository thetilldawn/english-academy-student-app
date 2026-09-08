import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), search: vi.fn(), Unavailable: class extends Error {} }));
vi.mock("@/lib/auth/admin", () => ({ getAdminContextOrThrow: mocks.auth, AdminAuthenticationUnavailableError: mocks.Unavailable }));
vi.mock("@/lib/observability/server-request-context", () => ({ getCurrentRequestContext: mocks.context }));
vi.mock("@/features/students/server/queries/school-search-query", () => ({ searchSchoolDirectory: mocks.search }));
import { POST } from "./route";
import { awaitWithAbortSignal } from "@/lib/network/request-policy";
function request(body: unknown = { query: "가짜" }, origin = "https://example.invalid") {
  return new Request("https://example.invalid/api/admin/schools/search", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue({ absoluteDeadlineAt: null }); mocks.auth.mockResolvedValue({ userId: "fake-admin" }); mocks.search.mockResolvedValue({ items: [], hasMore: false }); });
afterEach(() => vi.useRealTimers());
it("동일 출처와 관리자 권한 전에 외부 검색을 하지 않는다", async () => {
  expect((await POST(request(undefined, "https://other.invalid"))).status).toBe(403);
  expect(mocks.auth).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue(null);
  const response = await POST(request());
  expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.search).not.toHaveBeenCalled();
});
it("인증 장애는 미인증이나 정상 빈 결과가 아니다", async () => {
  mocks.auth.mockRejectedValue(new mocks.Unavailable("internal"));
  const response = await POST(request());
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("internal"); expect(mocks.search).not.toHaveBeenCalled();
});
it.each([{ query: "가" }, { query: "가짜", studentId: "secret" }, null])("입력 오류와 예상 밖 정보는 외부 전송 없이 차단한다 %#", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(mocks.search).not.toHaveBeenCalled();
});
it("정상 0건은 private no-store로 반환한다", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ items: [], hasMore: false });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.search).toHaveBeenCalledWith("가짜", expect.any(AbortSignal));
});
it("인증이 쓴 시간을 빼고 같은 신호로 남은 시간만 검색한다", async () => {
  vi.useFakeTimers(); mocks.context.mockResolvedValue({ absoluteDeadlineAt: Date.now() + 100 });
  let signal!: AbortSignal;
  mocks.auth.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ userId: "fake-admin" }), 60)));
  mocks.search.mockImplementation((_, input: AbortSignal) => { signal = input; return awaitWithAbortSignal(new Promise(() => {}), input); });
  const pending = POST(request());
  await vi.advanceTimersByTimeAsync(60); expect(mocks.search).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(40); expect(signal.aborted).toBe(true); expect((await pending).status).toBe(503);
});
it("멈춘 입력 본문도 시간 제한 오류이며 입력이 틀렸다고 하지 않는다", async () => {
  vi.useFakeTimers(); mocks.context.mockResolvedValue({ absoluteDeadlineAt: Date.now() + 20 });
  const input = request(); vi.spyOn(input, "json").mockImplementation(() => new Promise(() => {}));
  const pending = POST(input); await vi.advanceTimersByTimeAsync(20);
  expect((await pending).status).toBe(503); expect(mocks.search).not.toHaveBeenCalled();
});
