import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), page: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getAdminContext: mocks.admin }));
vi.mock("@/lib/services/wrong-word-command", () => ({ queueStudentWrongWords: vi.fn(), WrongWordQueueError: class extends Error {} }));
vi.mock("@/features/students/server/queries/wrong-word-page-query", () => ({ getStudentWrongWordPage: mocks.page, WrongWordPageForbiddenError: class extends Error {} }));
import { GET } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id }) };
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ id: "admin" }); mocks.page.mockResolvedValue({ items: [], totalCount: 0 }); });
describe("관리자 오답 조회 확장", () => {
  it("정확횟수범위를기존관리자인증경계로전달한다", async () => {
    const response = await GET(new Request("https://example.test/api/admin/students/" + id + "/wrong-words?minWrongCount=3&maxWrongCount=3"), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.page).toHaveBeenCalledWith(id, { filters: { datasetId: "", level: "all", query: "", minWrongCount: 3, maxWrongCount: 3 }, cursor: null }, { id: "admin" });
  });
  it("기존학생권한개방없고 잘못된 숫자를거절한다", async () => {
    mocks.admin.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://example.test/?minWrongCount=3"), context)).status).toBe(401);
    expect((await GET(new Request("https://example.test/?minWrongCount=0"), context)).status).toBe(400);
    expect(mocks.page).not.toHaveBeenCalled();
  });
});

