import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  client: null as ReturnType<typeof materialClient> | null,
  getServiceSupabaseClient: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  cacheLife: mocks.cacheLife,
  cacheTag: mocks.cacheTag,
  revalidateTag: mocks.revalidateTag,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: mocks.getServiceSupabaseClient,
}));

import {
  loadSharedVocabMaterialSnapshot,
  revalidateSharedVocabMaterialCache,
  SHARED_VOCAB_MATERIAL_CACHE_TAG,
} from "./shared-vocab-material-cache";

type QueryResult = { data: unknown[]; error: null };

function queryBuilder(result: QueryResult) {
  const builder = {
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    select: vi.fn(() => builder),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function materialClient() {
  const rowsByTable: Record<string, unknown[]> = {
    vocab_datasets: [
      {
        id: "dataset-a",
        dataset_key: "key-a",
        title: "단어장 A",
        edition: null,
        row_count: 10,
        status: "ready",
        is_active: true,
      },
    ],
    vocab_dataset_catalog: [
      {
        dataset_id: "dataset-a",
        display_name: "표시 A",
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
  };
  return {
    from: vi.fn((table: string) =>
      queryBuilder({ data: rowsByTable[table] ?? [], error: null })
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = materialClient();
  mocks.getServiceSupabaseClient.mockReturnValue(mocks.client);
});

describe("shared vocabulary material cache", () => {
  it("reads only the public material directory and returns serializable data", async () => {
    const snapshot = await loadSharedVocabMaterialSnapshot();

    expect(mocks.cacheLife).toHaveBeenCalledWith({
      stale: 60,
      revalidate: 300,
      expire: 600,
    });
    expect(mocks.cacheTag).toHaveBeenCalledWith(
      SHARED_VOCAB_MATERIAL_CACHE_TAG,
    );
    expect(mocks.client?.from.mock.calls.map(([table]) => table)).toEqual([
      "vocab_datasets",
      "vocab_dataset_catalog",
    ]);
    expect(snapshot.datasetLabels).toEqual([["dataset-a", "표시 A"]]);
    expect(() => structuredClone(snapshot)).not.toThrow();
    expect(JSON.stringify(snapshot)).not.toMatch(
      /student|assignment|attempt|wrong|point|adminUserId|timeTemplate/iu,
    );
  });

  it("revalidates only the shared material tag", () => {
    revalidateSharedVocabMaterialCache();

    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      SHARED_VOCAB_MATERIAL_CACHE_TAG,
      "max",
    );
  });

  it("keeps request identity APIs out of the cached module", () => {
    const source = fs.readFileSync(
      path.resolve("src/lib/services/shared-vocab-material-cache.ts"),
      "utf8",
    );

    expect(source).toContain('"use cache"');
    expect(source).not.toMatch(/next\/headers|cookies\(|headers\(|requireAdmin/);
    expect(source).not.toMatch(/students|assignments|attempts|wrong_words|points/);
  });
});
