import { describe, expect, it } from "vitest";

import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
  groupCataloguedUnits,
  type CataloguedDataset,
} from "@/lib/admin/dataset-catalog";

function dataset(
  overrides: Partial<CataloguedDataset>,
): CataloguedDataset {
  return {
    id: "dataset-a",
    title: "원본 제목",
    edition: null,
    displayName: "영어 자료",
    catalogGroup: "high",
    materialKind: "wordbook",
    gradeCode: "g10",
    publisher: null,
    seriesTitle: null,
    academicYear: null,
    curriculumRevision: null,
    editionLabel: null,
    isAssignable: true,
    catalogSortIndex: 0,
    ...overrides,
  };
}

describe("vocabulary dataset catalog", () => {
  it("formats textbook revision and exam year without changing raw titles", () => {
    expect(
      cataloguedDatasetDisplayLabel(
        dataset({
          displayName: "천재(이) 영어 3",
          materialKind: "textbook",
          curriculumRevision: "2015",
        }),
      ),
    ).toBe("[2015 개정] 천재(이) 영어 3");
    expect(
      cataloguedDatasetDisplayLabel(
        dataset({
          displayName: "고3 모의고사 · 장문독해",
          catalogGroup: "high_mock",
          materialKind: "exam_collection",
          academicYear: 2025,
        }),
      ),
    ).toBe("[2025] 고3 모의고사 · 장문독해");
  });

  it("groups datasets in the agreed middle to csat order", () => {
    const groups = groupCataloguedDatasets([
      dataset({ id: "csat", catalogGroup: "csat" }),
      dataset({ id: "middle", catalogGroup: "middle" }),
      dataset({ id: "mock", catalogGroup: "high_mock" }),
      dataset({ id: "high", catalogGroup: "high" }),
    ]);

    expect(groups.map((group) => group.group)).toEqual([
      "middle",
      "high",
      "high_mock",
      "csat",
    ]);
  });

  it("keeps mock-exam and csat scopes separate inside one dataset", () => {
    const groups = groupCataloguedUnits([
      {
        id: "mock",
        sortIndex: 1,
        catalogGroup: "high_mock" as const,
        unitType: "exam_scope" as const,
        displayName: "3월 서울교육청 41-42",
        academicYear: 2025,
        examMonth: 3,
        agency: "서울교육청",
        itemRange: "41-42",
        catalogSortIndex: 1,
      },
      {
        id: "csat",
        sortIndex: 2,
        catalogGroup: "csat" as const,
        unitType: "exam_scope" as const,
        displayName: "11월 대수능 41-42",
        academicYear: 2025,
        examMonth: 11,
        agency: "대수능",
        itemRange: "41-42",
        catalogSortIndex: 2,
      },
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "고등 모의고사",
      "수능",
    ]);
  });
});
