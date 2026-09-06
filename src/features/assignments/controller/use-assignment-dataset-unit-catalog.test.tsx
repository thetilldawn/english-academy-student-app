// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssignmentUnitItem } from "../catalog-types";
import { useAssignmentDatasetUnitCatalog } from "./use-assignment-dataset-unit-catalog";
import { loadAssignmentDatasetUnits } from "../transport/assignment-workspace-reads";
vi.mock("../transport/assignment-workspace-reads", () => ({ loadAssignmentDatasetUnits: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const units: AssignmentUnitItem[] = [{
  academicYear: 2025,
  agency: "서울교육청",
  catalogGroup: "high_mock",
  catalogSortIndex: 1,
  datasetId: "00000000-0000-4000-8000-000000000001",
  displayName: "2025-03 서울교육청 41-42",
  entryCount: 46,
  examMonth: 3,
  id: "00000000-0000-4000-8000-000000000002",
  itemRange: "41-42",
  kind: "day",
  label: "2025-03 서울교육청 41-42",
  number: null,
  sortIndex: 1,
  unitType: "exam_scope",
}];

describe("배정 단어 범위 목록", () => {
  it("초기에 정상 빈 단위를 읽은 단어장은 다시 요청하지 않는다", async () => {
    const initial: AssignmentUnitItem[] = [];
    const { result } = renderHook(() => useAssignmentDatasetUnitCatalog(initial, "fake-book"));
    await act(() => result.current.actions.ensureDataset("fake-book"));
    expect(result.current.state.status).toBe("ready"); expect(result.current.units).toEqual([]);
    expect(loadAssignmentDatasetUnits).not.toHaveBeenCalled();
  });
  it("미조회 빈배열은 읽고 같은 진행중 요청을 합치며 성공 빈값을 보존한다", async () => {
    let resolve!: (value: { datasetId: string; units: AssignmentUnitItem[] }) => void;
    vi.mocked(loadAssignmentDatasetUnits).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const initial: AssignmentUnitItem[] = [];
    const { result } = renderHook(() => useAssignmentDatasetUnitCatalog(initial));
    act(() => { void result.current.actions.ensureDataset("fake-book"); void result.current.actions.ensureDataset("fake-book"); });
    expect(loadAssignmentDatasetUnits).toHaveBeenCalledOnce();
    await act(async () => resolve({ datasetId: "fake-book", units: [] }));
    await act(() => result.current.actions.ensureDataset("fake-book"));
    expect(loadAssignmentDatasetUnits).toHaveBeenCalledOnce(); expect(result.current.state.status).toBe("ready");
  });
  it("실패 뒤 명시 재시도는 실제 새 조회를 한다", async () => {
    vi.mocked(loadAssignmentDatasetUnits).mockRejectedValueOnce(new Error("실패")).mockResolvedValueOnce({ datasetId: "fake-book", units: [] });
    const initial: AssignmentUnitItem[] = [];
    const { result } = renderHook(() => useAssignmentDatasetUnitCatalog(initial));
    await act(() => result.current.actions.ensureDataset("fake-book")); expect(result.current.state.status).toBe("error");
    await act(() => result.current.actions.retry()); expect(result.current.state.status).toBe("ready");
    expect(loadAssignmentDatasetUnits).toHaveBeenCalledTimes(2);
  });
  it("부모 화면이 다시 그려져도 같은 범위 목록 참조를 유지한다", () => {
    const { result, rerender } = renderHook(
      ({ marker }: { marker: number }) => ({
        catalog: useAssignmentDatasetUnitCatalog(units),
        marker,
      }),
      { initialProps: { marker: 0 } },
    );
    const initialUnits = result.current.catalog.units;

    rerender({ marker: 1 });

    expect(result.current.catalog.units).toBe(initialUnits);
  });
});
