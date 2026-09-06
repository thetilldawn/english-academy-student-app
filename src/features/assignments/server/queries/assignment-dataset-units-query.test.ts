import fs from "node:fs";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), from: vi.fn(), order: vi.fn(), filter: vi.fn(), rows: {} as Record<string, { data: unknown; error: null | { message: string } }> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ from: mocks.from }) }));
import { getPreparedAssignmentDatasetUnits, loadAssignmentDatasetMaterial } from "./assignment-dataset-units-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";
const rawDataset = { id: "fake-book", dataset_key: "fake", title: "가짜", edition: null, row_count: 0, status: "ready", is_active: true };
const units = [
  { id: "b", dataset_id: "fake-book", unit_label: "DAY 2", unit_kind: "day", unit_number: 0, sort_index: 0, entry_count: 0 },
  { id: "a", dataset_id: "fake-book", unit_label: "보충", unit_kind: "supplement", unit_number: null, sort_index: 1, entry_count: 10 },
];
const dataset = { ...cataloguedDatasetFromMetadata({ id: "fake-book", title: "가짜" }, undefined), datasetKey: "fake", rowCount: 0, status: "ready" as const, isActive: true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ userId: "fake-admin" });
  mocks.rows = {
    vocab_datasets: { data: { ...rawDataset }, error: null }, vocab_dataset_catalog: { data: null, error: null },
    vocab_units: { data: units, error: null }, vocab_unit_catalog: { data: [], error: null },
  };
  mocks.from.mockImplementation((table: string) => ({ select: () => ({
    eq: (key: string, value: string) => { mocks.filter(table, key, value); return { maybeSingle: async () => mocks.rows[table], order: (column: string) => { mocks.order(table, column); return Promise.resolve(mocks.rows[table]); } }; },
    in: async (key: string, values: string[]) => { mocks.filter(table, key, values); return mocks.rows[table]; },
  }) }));
});
it("별도 범위조회는 인증과 현재 단어장/분류를 확인하며 legacy분류 누락을 허용한다", async () => {
  const result = await loadAssignmentDatasetMaterial("fake-book");
  expect(mocks.requireAdmin).toHaveBeenCalledOnce();
  expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["vocab_datasets", "vocab_dataset_catalog", "vocab_units", "vocab_unit_catalog"]);
  expect(mocks.order).toHaveBeenCalledWith("vocab_units", "sort_index");
  expect(result.dataset.isAssignable).toBe(true);
  expect(result.units.map(({ id }) => id)).toEqual(["b", "a"]);
  expect(result.units[0]).toMatchObject({ number: 0, sortIndex: 0, entryCount: 0, displayName: "DAY 2" });
  expect(result.units[1]).toMatchObject({ number: null, kind: "supplement", label: "보충" });
});
it("준비요청의 같은 자료는 단위/단위분류만 읽고 같은 결과를 만든다", async () => {
  const expected = await loadAssignmentDatasetMaterial("fake-book");
  mocks.from.mockClear();
  const result = await getPreparedAssignmentDatasetUnits(await createServerSupabaseClient(), dataset);
  expect(result).toEqual({ datasetId: "fake-book", units: expected.units });
  expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["vocab_units", "vocab_unit_catalog"]);
});
it("선택 자료/단위 ID로만 같은 클라이언트를 조회하고 분류 표시값을 순서 변경 없이 결합한다", async () => {
  mocks.rows.vocab_unit_catalog.data = [{ unit_id: "b", academic_year: 0, agency: "분류 기관", catalog_group: "high_mock", sort_index: 99,
    display_name: "분류 표시", exam_month: 0, item_range: "29", unit_type: "exam_scope" }];
  const scopedFrom = vi.fn(mocks.from);
  const client = { from: scopedFrom } as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>;
  const result = await getPreparedAssignmentDatasetUnits(client, dataset);
  expect(scopedFrom.mock.calls.map(([table]) => table)).toEqual(["vocab_units", "vocab_unit_catalog"]);
  expect(mocks.filter).toHaveBeenCalledWith("vocab_units", "dataset_id", "fake-book");
  expect(mocks.filter).toHaveBeenCalledWith("vocab_unit_catalog", "unit_id", ["b", "a"]);
  expect(result.units.map((unit) => unit.id)).toEqual(["b", "a"]);
  expect(result.units[0]).toMatchObject({ academicYear: 0, examMonth: 0, displayName: "분류 표시", catalogSortIndex: 99, sortIndex: 0 });
  expect(result.units[1].displayName).toBe("보충");
});
it("유효 단어장의 정상 빈단위는 분류 조회를 하지 않는다", async () => {
  mocks.rows.vocab_units.data = [];
  expect((await loadAssignmentDatasetMaterial("fake-book")).units).toEqual([]);
  expect(mocks.from).not.toHaveBeenCalledWith("vocab_unit_catalog");
  mocks.from.mockClear();
  expect((await getPreparedAssignmentDatasetUnits(await createServerSupabaseClient(), dataset)).units).toEqual([]);
  expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["vocab_units"]);
});
it.each([null, { ...rawDataset, is_active: false }, { ...rawDataset, status: "pending_review" }])("없는/배정불가 단어장은 오류이며 후속 분류를 읽지 않는다", async (row) => {
  mocks.rows.vocab_datasets.data = row;
  await expect(loadAssignmentDatasetMaterial("fake-book")).rejects.toMatchObject({ reason: "invalid_dataset" });
  expect(mocks.from).not.toHaveBeenCalledWith("vocab_unit_catalog");
});
it("분류의 명시적 배정금지를 지키며 historical에는 과거자료를 보존한다", async () => {
  mocks.rows.vocab_dataset_catalog.data = { is_assignable: false };
  await expect(loadAssignmentDatasetMaterial("fake-book")).rejects.toMatchObject({ reason: "invalid_dataset" });
  mocks.rows.vocab_datasets.data = { ...rawDataset, status: "retired", is_active: false };
  expect((await loadAssignmentDatasetMaterial("fake-book", undefined, "historical")).dataset.isActive).toBe(false);
  mocks.rows.vocab_datasets.data = null;
  await expect(loadAssignmentDatasetMaterial("fake-book", undefined, "historical")).rejects.toMatchObject({ reason: "invalid_dataset" });
});
it.each(["vocab_datasets", "vocab_dataset_catalog", "vocab_units", "vocab_unit_catalog"])("%s 오류를 빈단위로 감추지 않는다", async (table) => {
  mocks.rows[table].error = { message: "private SQL" };
  await expect(loadAssignmentDatasetMaterial("fake-book")).rejects.toMatchObject({ reason: "unavailable" });
});
it("권한 거절은 DB 읽기 전에 중단한다", async () => {
  mocks.requireAdmin.mockRejectedValue(new Error("denied"));
  await expect(loadAssignmentDatasetMaterial("fake-book")).rejects.toThrow("denied");
  expect(mocks.from).not.toHaveBeenCalled();
});
it("새 내부 준비 경로는 준비 query에서만 사용하고 공개 최종검증 경로는 유지한다", () => {
  const root = path.join(process.cwd(), "src");
  const uses: string[] = [];
  function walk(directory: string) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file) && !/\.test\./.test(file) && fs.readFileSync(file, "utf8").includes("getPreparedAssignmentDatasetUnits")) uses.push(path.basename(file));
    }
  }
  walk(root);
  expect(uses.sort()).toEqual(["assignment-dataset-units-query.ts", "assignment-planner-preparation-query.ts"]);
});
