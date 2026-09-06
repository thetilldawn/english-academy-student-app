import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  getStudentDirectoryInitial: vi.fn(),
  getStudentDirectoryNextPage: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getAdminContextOrThrow: mocks.getAdminContext,
  AdminAuthenticationUnavailableError: class extends Error {},
}));
vi.mock("@/features/students/server/queries/student-directory-query", () => ({
  getStudentDirectoryInitial: mocks.getStudentDirectoryInitial,
  getStudentDirectoryNextPage: mocks.getStudentDirectoryNextPage,
}));

import { StudentDirectoryCursorError } from "@/features/students/server/student-directory-cursor";
import { POST } from "./route";
import { AdminAuthenticationUnavailableError } from "@/lib/auth/admin";

const filters = {
  classGroupId: "",
  grade: "",
  query: "",
  school: "",
  status: "all",
  wordbook: "",
  wrong: "all",
} as const;

function request(body: unknown, origin?: string) {
  return new Request("http://localhost/api/admin/students/directory", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    method: "POST",
  });
}

function expectPrivate(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

describe("POST /api/admin/students/directory", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.getStudentDirectoryInitial.mockResolvedValue({
      filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] },
      filters,
      page: { items: [], nextCursor: null },
      snapshotAt: "2026-08-29T00:00:00.000Z",
      totalCount: 0,
    });
    mocks.getStudentDirectoryNextPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  it("인증 서버 장애는 503이며 학생 자료를 읽지 않는다", async () => {
    mocks.getAdminContext.mockRejectedValueOnce(new AdminAuthenticationUnavailableError("AUTH_UPSTREAM_UNAVAILABLE"));
    expectPrivate(await POST(request({ mode: "cache", filters })), 503);
    expect(mocks.getStudentDirectoryInitial).not.toHaveBeenCalled();
  });
  it("캐시 최초 읽기도 현재 인증 뒤 한 번만 실행한다", async () => {
    const result = await POST(request({ mode: "cache", filters })); expectPrivate(result, 200);
    expect(await result.json()).toMatchObject({ kind: "snapshot", identity: null });
    expect(mocks.getStudentDirectoryInitial).toHaveBeenCalledOnce();
  });
  it.each([Array(11).fill("00000000-0000-4000-8000-000000000001"), Array(2).fill("00000000-0000-4000-8000-000000000001")])("캐시 학생 중복/상한을 거절한다", async studentIds => {
    expectPrivate(await POST(request({ mode: "cache", filters, studentIds })), 400);
    expect(mocks.getStudentDirectoryInitial).not.toHaveBeenCalled();
  });
  it.each([{ cacheIdentity: "a".repeat(64) }, { cacheUserId: "00000000-0000-4000-8000-000000000999" }])("불완전한 페이지 세대 짝을 거절한다", async extra => {
    expectPrivate(await POST(request({ mode: "page", filters, cursor: "c", ...extra })), 400);
    expect(mocks.getStudentDirectoryNextPage).not.toHaveBeenCalled();
  });
  it.each(["00000000-0000-4000-8000-000000000999", "00000000-0000-4000-8000-000000000888"])("페이지 계정/세대가 다르면 읽지 않는다", async cacheUserId => {
    mocks.getAdminContext.mockResolvedValueOnce({ userId: "00000000-0000-4000-8000-000000000999", sessionId: "new-session" });
    expectPrivate(await POST(request({ mode: "page", filters, cursor: "c", cacheUserId, cacheIdentity: "a".repeat(64) })), 401);
    expect(mocks.getStudentDirectoryNextPage).not.toHaveBeenCalled();
  });
  it("서버 세대가 없는 현재 계정은 일반 페이지 조회를 허용한다", async () => {
    const userId = "00000000-0000-4000-8000-000000000999"; mocks.getAdminContext.mockResolvedValueOnce({ userId });
    expectPrivate(await POST(request({ mode: "page", filters, cursor: "c", cacheUserId: userId, cacheIdentity: null })), 200);
  });

  it("returns initial and next pages as private responses", async () => {
    const initialInput = { filters, mode: "initial" } as const;
    const initial = await POST(request(initialInput));
    expectPrivate(initial, 200);
    expect(mocks.getStudentDirectoryInitial).toHaveBeenCalledWith(
      initialInput,
      { userId: "admin-id" },
    );

    const pageInput = { cursor: "opaque", filters, mode: "page" } as const;
    const page = await POST(request(pageInput));
    expectPrivate(page, 200);
    expect(mocks.getStudentDirectoryNextPage).toHaveBeenCalledWith(
      pageInput,
      { userId: "admin-id" },
    );
  });

  it("rejects another origin, no session, and invalid input without reading", async () => {
    const blocked = await POST(request(
      { filters, mode: "initial" },
      "https://attacker.example",
    ));
    expectPrivate(blocked, 403);

    mocks.getAdminContext.mockResolvedValueOnce(null);
    const unauthorized = await POST(request({ filters, mode: "initial" }));
    expectPrivate(unauthorized, 401);

    const invalid = await POST(request({
      filters: { ...filters, status: "unknown" },
      mode: "initial",
    }));
    expectPrivate(invalid, 400);
    expect(mocks.getStudentDirectoryInitial).not.toHaveBeenCalled();
    expect(mocks.getStudentDirectoryNextPage).not.toHaveBeenCalled();
  });

  it("keeps cursor and read failures private", async () => {
    const pageInput = { cursor: "opaque", filters, mode: "page" } as const;
    mocks.getStudentDirectoryNextPage.mockRejectedValueOnce(
      new StudentDirectoryCursorError(),
    );
    expectPrivate(await POST(request(pageInput)), 409);

    mocks.getStudentDirectoryNextPage.mockRejectedValueOnce(new Error("db"));
    expectPrivate(await POST(request(pageInput)), 503);
  });
});
