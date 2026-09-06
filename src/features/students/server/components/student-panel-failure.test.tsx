import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDirectory: vi.fn(),
  loadMaterial: vi.fn(),
  rethrow: vi.fn(),
  headers: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.rethrow,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/services/admin-material-read-service", () => ({
  loadCurrentAdminMaterialSnapshotForRsc: mocks.loadMaterial,
}));
vi.mock("../queries/student-directory-query", () => ({
  getStudentDirectoryInitial: mocks.loadDirectory,
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/env")>(),
  getAppOrigin: () => "https://example.invalid",
}));

import { PanelLoadFailure } from "@/design-system/patterns/route-state/route-state";

import { StudentCreateContent } from "./student-create-content";
import { StudentDirectoryContent } from "./student-directory-content";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rethrow.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("student page panel failure isolation", () => {
  it("문서 최초 읽기는 서버에서 인증한 한 응답을 인계한다", async () => {
    vi.stubEnv("STUDENT_DIRECTORY_CACHE_CANARY", "1"); mocks.headers.mockResolvedValue(new Headers({ "sec-fetch-dest": "document" }));
    const admin = { userId: "fake-admin", displayName: "가짜", sessionId: "fake-session" }; mocks.admin.mockResolvedValue(admin); mocks.loadDirectory.mockResolvedValue({ marker: "server" });
    const result = await StudentDirectoryContent(); expect(result.props.initialResponse).toMatchObject({ kind: "snapshot", userId: "fake-admin", snapshot: { marker: "server" } });
    expect(mocks.loadDirectory).toHaveBeenCalledWith(expect.any(Object), admin); expect(mocks.admin).toHaveBeenCalledOnce();
  });
  it("Client 재진입은 최초 서버 목록과 중복하지 않고 API에서 인증한다", async () => {
    vi.stubEnv("STUDENT_DIRECTORY_CACHE_CANARY", "1"); mocks.headers.mockResolvedValue(new Headers({ "sec-fetch-dest": "empty" }));
    const result = await StudentDirectoryContent(); expect(result.props.initialResponse).toBeUndefined(); expect(mocks.loadDirectory).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("접힌 등록 준비는 서버에서 자료를 조회하지 않는다", () => {
    const result = StudentCreateContent();
    expect(mocks.loadMaterial).not.toHaveBeenCalled();
    expect(result.props).toEqual({ appOrigin: "https://example.invalid" });
  });
  it.each(["0", "1"])("목록 조회 실패는 해당 패널의 복구 안내로 표시한다: cache=%s", async (flag) => {
    vi.stubEnv("STUDENT_DIRECTORY_CACHE_CANARY", flag);
    mocks.headers.mockResolvedValue(new Headers({ "sec-fetch-dest": "document" }));
    mocks.admin.mockResolvedValue({ userId: "fake-admin", sessionId: "fake-session" });
    mocks.loadDirectory.mockRejectedValue(new Error("database unavailable"));
    const result = await StudentDirectoryContent();

    expect(mocks.rethrow).toHaveBeenCalledTimes(1);
    expect(result.type).toBe(PanelLoadFailure);
    expect(result.props.retryHref).toBe("/admin/students");
  });

  it.each(["0", "1"])("lets Next.js navigation errors escape the local panel: cache=%s", async (flag) => {
    vi.stubEnv("STUDENT_DIRECTORY_CACHE_CANARY", flag);
    mocks.headers.mockResolvedValue(new Headers({ "sec-fetch-dest": "document" }));
    mocks.admin.mockResolvedValue({ userId: "fake-admin", sessionId: "fake-session" });
    const navigationError = new Error("NEXT_REDIRECT");
    mocks.loadDirectory.mockRejectedValue(navigationError);
    mocks.rethrow.mockImplementation(() => {
      throw navigationError;
    });

    await expect(StudentDirectoryContent()).rejects.toBe(navigationError);
  });
});
