import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheStores: [] as Array<Map<string, unknown>>,
  createServerSupabaseClient: vi.fn(),
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

import {
  loadCurrentAdminDatasetDisplayLabelMapForRsc,
  loadCurrentAdminMaterialSnapshotForRsc,
  loadCurrentAdminVocabUnitsForRsc,
} from "./admin-material-read-service";

type QueryResult = { data: unknown[]; error: null };

function queryBuilder(result: QueryResult) {
  const builder = {
    order: vi.fn(() => builder),
    select: vi.fn(() => builder),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function materialClient(label: string) {
  const rowsByTable: Record<string, unknown[]> = {
    vocab_datasets: [
      {
        id: `dataset-${label}`,
        dataset_key: `key-${label}`,
        title: `단어장 ${label}`,
        edition: null,
        row_count: 10,
        status: "ready",
        is_active: true,
      },
    ],
    vocab_dataset_catalog: [
      {
        dataset_id: `dataset-${label}`,
        display_name: `표시 ${label}`,
        catalog_group: "wordbook",
        material_kind: "wordbook",
        grade_code: null,
        publisher: null,
        series_title: null,
        academic_year: null,
        curriculum_revision: null,
        edition_label: null,
        is_assignable: true,
        sort_index: 0,
      },
    ],
    vocab_units: [
      {
        id: `unit-${label}`,
        dataset_id: `dataset-${label}`,
        unit_label: "DAY 01",
        unit_kind: "day",
        unit_number: 1,
        sort_index: 1,
        entry_count: 10,
      },
    ],
    vocab_unit_catalog: [
      {
        unit_id: `unit-${label}`,
        catalog_group: "wordbook",
        unit_type: "day",
        display_name: "DAY 01",
        academic_year: null,
        exam_month: null,
        agency: null,
        item_range: null,
        sort_index: 1,
      },
    ],
  };
  return {
    from: vi.fn((table: string) =>
      queryBuilder({ data: rowsByTable[table] ?? [], error: null }),
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const store of mocks.cacheStores) store.clear();
  mocks.requireAdmin.mockResolvedValue({
    userId: "admin-a",
    displayName: "관리자 A",
  });
});

describe("admin material React request cache", () => {
  it("deduplicates each public material query within one RSC request", async () => {
    const client = materialClient("a");
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const [firstMaterial, secondMaterial, labels, firstUnits, secondUnits] =
      await Promise.all([
        loadCurrentAdminMaterialSnapshotForRsc(),
        loadCurrentAdminMaterialSnapshotForRsc(),
        loadCurrentAdminDatasetDisplayLabelMapForRsc([
          { id: "dataset-a", title: "단어장 a", edition: null },
        ]),
        loadCurrentAdminVocabUnitsForRsc(),
        loadCurrentAdminVocabUnitsForRsc(),
      ]);

    expect(firstMaterial).toBe(secondMaterial);
    expect(labels.get("dataset-a")).toBe(firstMaterial.datasetLabelById.get("dataset-a"));
    expect(firstUnits).toBe(secondUnits);
    expect(mocks.createServerSupabaseClient).toHaveBeenCalledTimes(2);
    expect(client.from).toHaveBeenCalledTimes(4);
    expect(client.from.mock.calls.map(([table]) => table)).toEqual([
      "vocab_datasets",
      "vocab_dataset_catalog",
      "vocab_units",
      "vocab_unit_catalog",
    ]);
  });

  it("uses the primitive administrator id as a cache partition key", async () => {
    const clientA = materialClient("a");
    const clientB = materialClient("b");
    mocks.requireAdmin
      .mockResolvedValueOnce({ userId: "admin-a", displayName: "관리자 A" })
      .mockResolvedValueOnce({ userId: "admin-b", displayName: "관리자 B" });
    mocks.createServerSupabaseClient
      .mockResolvedValueOnce(clientA)
      .mockResolvedValueOnce(clientB);

    const first = await loadCurrentAdminMaterialSnapshotForRsc();
    const second = await loadCurrentAdminMaterialSnapshotForRsc();

    expect(first.allDatasets[0]?.id).toBe("dataset-a");
    expect(second.allDatasets[0]?.id).toBe("dataset-b");
    expect(clientA.from).toHaveBeenCalledTimes(2);
    expect(clientB.from).toHaveBeenCalledTimes(2);
  });
});
