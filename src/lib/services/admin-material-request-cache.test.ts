import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadShared: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("./shared-vocab-material-cache", () => ({
  loadSharedVocabMaterialSnapshot: mocks.loadShared,
}));

import { loadCurrentAdminMaterialSnapshotForRsc } from "./admin-material-read-service";

const sharedSnapshot = {
  allDatasets: [],
  datasetLabels: [["dataset-a", "단어장 A"]] as Array<readonly [string, string]>,
  selectableDatasets: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    userId: "admin-a",
    displayName: "관리자 A",
  });
  mocks.loadShared.mockResolvedValue(sharedSnapshot);
});

describe("admin material cached RSC boundary", () => {
  it("authenticates before entering the shared material cache", async () => {
    const material = await loadCurrentAdminMaterialSnapshotForRsc();

    expect(material.datasetLabelById.get("dataset-a")).toBe("단어장 A");
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.loadShared).toHaveBeenCalledTimes(1);
    expect(mocks.requireAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadShared.mock.invocationCallOrder[0]!,
    );
  });

  it("never reads shared service data when admin authentication fails", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("redirect"));

    await expect(loadCurrentAdminMaterialSnapshotForRsc()).rejects.toThrow(
      "redirect",
    );
    expect(mocks.loadShared).not.toHaveBeenCalled();
  });
});
