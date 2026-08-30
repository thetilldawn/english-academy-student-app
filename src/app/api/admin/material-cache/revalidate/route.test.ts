import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  isSameOriginRequest: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>(
    "@/lib/http",
  );
  return { ...actual, isSameOriginRequest: mocks.isSameOriginRequest };
});
vi.mock("@/lib/services/shared-vocab-material-cache", () => ({
  revalidateSharedVocabMaterialCache: mocks.revalidate,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSameOriginRequest.mockReturnValue(true);
  mocks.getAdminContext.mockResolvedValue({
    userId: "admin-preview",
    displayName: "관리자",
  });
});

describe("POST /api/admin/material-cache/revalidate", () => {
  it("revalidates only after same-origin admin authentication", async () => {
    const response = await POST(new Request("http://localhost/api/admin/material-cache/revalidate", {
      method: "POST",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate for unauthenticated or cross-origin requests", async () => {
    mocks.isSameOriginRequest.mockReturnValueOnce(false);
    const forbidden = await POST(new Request("http://localhost/api/admin/material-cache/revalidate", {
      method: "POST",
    }));
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.getAdminContext.mockResolvedValueOnce(null);
    const unauthorized = await POST(new Request("http://localhost/api/admin/material-cache/revalidate", {
      method: "POST",
    }));

    expect(forbidden.status).toBe(403);
    expect(unauthorized.status).toBe(401);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
