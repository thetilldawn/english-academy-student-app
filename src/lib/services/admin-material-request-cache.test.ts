import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheEntries: new Map<string, unknown>(),
  createServerClient: vi.fn(),
  loadMaterial: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({
  cache:
    <TResult>(loader: (key: string) => Promise<TResult>) =>
    async (key: string) => {
      if (!mocks.cacheEntries.has(key)) {
        mocks.cacheEntries.set(key, loader(key));
      }
      return mocks.cacheEntries.get(key) as Promise<TResult>;
    },
}));
vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerClient,
}));
vi.mock("./admin-material-query", () => ({
  loadAdminMaterialSnapshot: mocks.loadMaterial,
  toSelectableDatasetOptions: vi.fn(),
}));

import { loadCurrentAdminMaterialSnapshotForRsc } from "./admin-material-read-service";

const snapshot = {
  allDatasets: [],
  datasetLabelById: new Map([["dataset-a", "단어장 A"]]),
  selectableDatasets: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheEntries.clear();
  mocks.requireAdmin.mockResolvedValue({
    userId: "admin-a",
    displayName: "관리자 A",
  });
  mocks.createServerClient.mockResolvedValue({ kind: "session-client" });
  mocks.loadMaterial.mockResolvedValue(snapshot);
});

describe("admin material request cache boundary", () => {
  it("authenticates first and memoizes the material query within one RSC request", async () => {
    const first = await loadCurrentAdminMaterialSnapshotForRsc();
    const second = await loadCurrentAdminMaterialSnapshotForRsc();

    expect(first).toBe(snapshot);
    expect(second).toBe(snapshot);
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(2);
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    expect(mocks.loadMaterial).toHaveBeenCalledTimes(1);
    expect(mocks.requireAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createServerClient.mock.invocationCallOrder[0]!,
    );
  });

  it("does not create a database client when administrator authentication fails", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("redirect"));

    await expect(loadCurrentAdminMaterialSnapshotForRsc()).rejects.toThrow(
      "redirect",
    );
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.loadMaterial).not.toHaveBeenCalled();
  });
});
