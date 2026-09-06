import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ headers: new Headers(), admin: vi.fn(), initial: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("./admin-history-list-query", () => ({ listAdminHistoryInitial: mocks.initial }));
import { getHistoryListCacheSeed } from "./history-list-entry-query";
const filters = { currentOnly: false };
beforeEach(() => { vi.clearAllMocks(); mocks.headers = new Headers(); mocks.admin.mockResolvedValue({ userId: "fake-admin", displayName: "가짜", sessionId: "fake-session" }); mocks.initial.mockResolvedValue({ filters }); });
describe("최초 문서 인계", () => {
  it.each([["sec-fetch-dest", "document"], ["accept", "text/html"]])("현재 서버 인증/목록을 한 번만 읽는다: %s=%s", async (key, value) => {
    mocks.headers = new Headers({ [key]: value });
    expect(await getHistoryListCacheSeed()).toMatchObject({ kind: "snapshot", userId: "fake-admin" });
    expect(mocks.admin).toHaveBeenCalledTimes(1); expect(mocks.initial).toHaveBeenCalledTimes(1);
    expect(mocks.initial.mock.calls[0][1]).toMatchObject({ userId: "fake-admin" });
  });
  it("Client 탐색에는 예전 목록이나 인증 결과를 새 인계로 만들지 않는다", async () => {
    mocks.headers = new Headers({ "sec-fetch-dest": "empty", accept: "text/x-component" });
    expect(await getHistoryListCacheSeed()).toBeUndefined(); expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.initial).not.toHaveBeenCalled();
  });
  it("문서 헤더도 권한을 대신하지 않는다", async () => {
    mocks.headers = new Headers({ "sec-fetch-dest": "document" }); mocks.admin.mockRejectedValue(new Error("not authorized"));
    await expect(getHistoryListCacheSeed()).rejects.toThrow("not authorized"); expect(mocks.initial).not.toHaveBeenCalled();
  });
});
