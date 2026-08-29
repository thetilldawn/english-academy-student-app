import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  getStudentHistoryInitial: vi.fn(),
  getStudentHistoryNextPage: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/features/students/server/queries/student-history-query", () => ({
  getStudentHistoryInitial: mocks.getStudentHistoryInitial,
  getStudentHistoryNextPage: mocks.getStudentHistoryNextPage,
}));

import { StudentHistoryCursorError } from "@/features/students/server/student-history-cursor";
import { POST } from "./route";

const studentId = "11111111-1111-4111-8111-111111111111";
const filters = { purpose: "all", section: "all", since: null } as const;
const params = { params: Promise.resolve({ id: studentId }) };

function request(body: unknown, origin?: string) {
  return new Request(`http://localhost/api/admin/students/${studentId}/history`, {
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

describe("POST /api/admin/students/[id]/history", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.getStudentHistoryInitial.mockResolvedValue({
      items: [],
      nextCursor: null,
      totalCount: 0,
    });
    mocks.getStudentHistoryNextPage.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  it("returns initial and next pages as private responses", async () => {
    const initial = await POST(
      request({ filters, mode: "initial" }),
      params,
    );
    expectPrivate(initial, 200);
    expect(mocks.getStudentHistoryInitial).toHaveBeenCalledWith(
      { filters, studentId },
      { userId: "admin-id" },
    );

    const page = await POST(
      request({ cursor: "opaque", filters, mode: "page" }),
      params,
    );
    expectPrivate(page, 200);
    expect(mocks.getStudentHistoryNextPage).toHaveBeenCalledWith(
      { cursor: "opaque", filters, studentId },
      { userId: "admin-id" },
    );
  });

  it("rejects another origin, no session, and invalid input without reading", async () => {
    const blocked = await POST(
      request({ filters, mode: "initial" }, "https://attacker.example"),
      params,
    );
    expectPrivate(blocked, 403);

    mocks.getAdminContext.mockResolvedValueOnce(null);
    const unauthorized = await POST(
      request({ filters, mode: "initial" }),
      params,
    );
    expectPrivate(unauthorized, 401);

    const invalid = await POST(
      request({ filters: { ...filters, section: "unknown" }, mode: "initial" }),
      params,
    );
    expectPrivate(invalid, 400);
    expect(mocks.getStudentHistoryInitial).not.toHaveBeenCalled();
    expect(mocks.getStudentHistoryNextPage).not.toHaveBeenCalled();
  });

  it("keeps cursor and read failures private", async () => {
    const pageInput = { cursor: "opaque", filters, mode: "page" } as const;
    mocks.getStudentHistoryNextPage.mockRejectedValueOnce(
      new StudentHistoryCursorError(),
    );
    expectPrivate(await POST(request(pageInput), params), 409);

    mocks.getStudentHistoryNextPage.mockRejectedValueOnce(new Error("db"));
    expectPrivate(await POST(request(pageInput), params), 503);
  });
});
