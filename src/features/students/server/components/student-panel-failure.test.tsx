import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDirectory: vi.fn(),
  loadMaterial: vi.fn(),
  rethrow: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: mocks.rethrow,
}));
vi.mock("@/lib/services/admin-material-read-service", () => ({
  loadCurrentAdminMaterialSnapshotForRsc: mocks.loadMaterial,
}));
vi.mock("../queries/student-directory-query", () => ({
  getStudentDirectoryInitial: mocks.loadDirectory,
}));

import { PanelLoadFailure } from "@/design-system/patterns/route-state/route-state";

import { StudentCreateContent } from "./student-create-content";
import { StudentDirectoryContent } from "./student-directory-content";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("student page panel failure isolation", () => {
  it.each([
    ["creation", mocks.loadMaterial, StudentCreateContent],
    ["directory", mocks.loadDirectory, StudentDirectoryContent],
  ])("renders a local failure for the %s panel", async (_, loader, component) => {
    loader.mockRejectedValue(new Error("database unavailable"));

    const result = await component();

    expect(mocks.rethrow).toHaveBeenCalledTimes(1);
    expect(result.type).toBe(PanelLoadFailure);
    expect(result.props.retryHref).toBe("/admin/students");
  });

  it("lets Next.js navigation errors escape the local panel", async () => {
    const navigationError = new Error("NEXT_REDIRECT");
    mocks.loadMaterial.mockRejectedValue(navigationError);
    mocks.rethrow.mockImplementation(() => {
      throw navigationError;
    });

    await expect(StudentCreateContent()).rejects.toBe(navigationError);
  });
});
