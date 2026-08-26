import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheStores: [] as Array<Map<string, unknown>>,
  createServerSupabaseClient: vi.fn(),
  loadCurrentAdminDatasetDisplayLabelMapForRsc: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({
  cache: (loader: (...args: unknown[]) => unknown) => {
    const results = new Map<string, unknown>();
    mocks.cacheStores.push(results);
    return (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (!results.has(key)) results.set(key, loader(...args));
      return results.get(key);
    };
  },
}));
vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/services/admin-material-read-service", () => ({
  loadCurrentAdminDatasetDisplayLabelMapForRsc:
    mocks.loadCurrentAdminDatasetDisplayLabelMapForRsc,
}));

import { listAssignmentHistoryBundle } from "./admin-history-read-service";

function emptyHistoryClient() {
  const query = {
    order: vi.fn(() => query),
    range: vi.fn(async () => ({ data: [], error: null })),
    select: vi.fn(() => query),
  };
  return {
    client: { from: vi.fn(() => query) },
    query,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const store of mocks.cacheStores) store.clear();
  mocks.requireAdmin.mockResolvedValue({ userId: "admin-id" });
  mocks.loadCurrentAdminDatasetDisplayLabelMapForRsc.mockResolvedValue(
    new Map(),
  );
});

describe("admin history request cache", () => {
  it("reuses the same read-only bundle within one request", async () => {
    const { client } = emptyHistoryClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await Promise.all([
      listAssignmentHistoryBundle(),
      listAssignmentHistoryBundle(),
    ]);

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.createServerSupabaseClient).toHaveBeenCalledOnce();
    expect(client.from).toHaveBeenCalledTimes(3);
  });

  it("shares history rows when only the material-label projection differs", async () => {
    const { client } = emptyHistoryClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await Promise.all([
      listAssignmentHistoryBundle(),
      listAssignmentHistoryBundle({
        reuseMaterialRequestCache: true,
      }),
    ]);

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.createServerSupabaseClient).toHaveBeenCalledOnce();
    expect(client.from).toHaveBeenCalledTimes(3);
    expect(
      mocks.loadCurrentAdminDatasetDisplayLabelMapForRsc,
    ).toHaveBeenCalledOnce();
  });
});
