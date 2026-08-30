// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AssignmentUnitItem } from "../catalog-types";
import { useAssignmentDatasetUnitCatalog } from "./use-assignment-dataset-unit-catalog";

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
