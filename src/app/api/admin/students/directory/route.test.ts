import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  getStudentDirectoryInitial: vi.fn(),
  getStudentDirectoryNextPage: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/features/students/server/queries/student-directory-query", () => ({
  getStudentDirectoryInitial: mocks.getStudentDirectoryInitial,
  getStudentDirectoryNextPage: mocks.getStudentDirectoryNextPage,
}));

import { StudentDirectoryCursorError } from "@/features/students/server/student-directory-cursor";
import { POST } from "./route";

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
