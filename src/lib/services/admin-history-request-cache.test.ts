import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  finalizeStaleQuizAttempts: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({
  cache: (loader: (...args: unknown[]) => unknown) => {
    const results = new Map<string, unknown>();
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
vi.mock("@/lib/services/stale-attempt-service", () => ({
  finalizeStaleQuizAttempts: mocks.finalizeStaleQuizAttempts,
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
  mocks.requireAdmin.mockResolvedValue({ userId: "admin-id" });
  mocks.finalizeStaleQuizAttempts.mockResolvedValue(0);
});

describe("admin history request cache", () => {
  it("reuses the same finalized bundle but keeps the non-finalizing load separate", async () => {
    const { client } = emptyHistoryClient();
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    await Promise.all([
      listAssignmentHistoryBundle(),
      listAssignmentHistoryBundle({ finalizeStale: true }),
    ]);

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.finalizeStaleQuizAttempts).toHaveBeenCalledOnce();
    expect(mocks.createServerSupabaseClient).toHaveBeenCalledOnce();
    expect(client.from).toHaveBeenCalledTimes(3);

    await Promise.all([
      listAssignmentHistoryBundle({ finalizeStale: false }),
      listAssignmentHistoryBundle({ finalizeStale: false }),
    ]);

    expect(mocks.requireAdmin).toHaveBeenCalledTimes(2);
    expect(mocks.finalizeStaleQuizAttempts).toHaveBeenCalledOnce();
    expect(mocks.createServerSupabaseClient).toHaveBeenCalledTimes(2);
    expect(client.from).toHaveBeenCalledTimes(6);
  });
});
