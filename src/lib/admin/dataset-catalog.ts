import { datasetDisplayLabel } from "@/lib/admin/dataset-display";

export const DATASET_CATALOG_GROUPS = [
  "middle",
  "high",
  "high_mock",
  "csat",
] as const;

export type DatasetCatalogGroup = (typeof DATASET_CATALOG_GROUPS)[number];

export type DatasetMaterialKind =
  | "textbook"
  | "wordbook"
  | "exam_collection"
  | "exam_prep"
  | "supplement";

export type VocabUnitType =
  | "day"
  | "lesson"
  | "chapter"
  | "exam_scope"
  | "passage_type"
  | "supplement";

export type CataloguedDataset = {
  id: string;
  title: string;
  edition: string | null;
  displayName: string;
  catalogGroup: DatasetCatalogGroup;
  materialKind: DatasetMaterialKind | null;
  gradeCode: string | null;
  publisher: string | null;
  seriesTitle: string | null;
  academicYear: number | null;
  curriculumRevision: string | null;
  editionLabel: string | null;
  isAssignable: boolean;
  catalogSortIndex: number;
};

export type RawCataloguedDataset = {
  id: string;
  title: string;
  edition?: string | null;
};

export type DatasetCatalogMetadata = {
  displayName: string;
  catalogGroup: DatasetCatalogGroup;
  materialKind: DatasetMaterialKind;
  gradeCode: string | null;
  publisher: string | null;
  seriesTitle: string | null;
  academicYear: number | null;
  curriculumRevision: string | null;
  editionLabel: string | null;
  isAssignable: boolean;
  sortIndex: number;
};

export type CataloguedUnit = {
  catalogGroup: DatasetCatalogGroup | null;
  unitType: VocabUnitType | null;
  displayName: string;
  academicYear: number | null;
  examMonth: number | null;
  agency: string | null;
  itemRange: string | null;
  catalogSortIndex: number;
};

const catalogGroupLabels: Record<DatasetCatalogGroup, string> = {
  middle: "중등",
  high: "고등",
  high_mock: "고3 모의고사",
  csat: "수능",
};

export function datasetCatalogGroupLabel(group: DatasetCatalogGroup) {
  return catalogGroupLabels[group];
}

export function cataloguedDatasetFromMetadata(
  dataset: RawCataloguedDataset,
  catalog: DatasetCatalogMetadata | undefined,
): CataloguedDataset {
  return {
    id: dataset.id,
    title: dataset.title,
    edition: dataset.edition ?? null,
    displayName:
      catalog?.displayName ??
      datasetDisplayLabel(dataset.title, dataset.edition),
    catalogGroup: catalog?.catalogGroup ?? "high",
    materialKind: catalog?.materialKind ?? null,
    gradeCode: catalog?.gradeCode ?? null,
    publisher: catalog?.publisher ?? null,
    seriesTitle: catalog?.seriesTitle ?? null,
    academicYear: catalog?.academicYear ?? null,
    curriculumRevision: catalog?.curriculumRevision ?? null,
    editionLabel: catalog?.editionLabel ?? null,
    isAssignable: catalog?.isAssignable ?? true,
    catalogSortIndex: catalog?.sortIndex ?? 1000,
  };
}

function prefixLabel(dataset: CataloguedDataset) {
  if (dataset.materialKind === "textbook" && dataset.curriculumRevision) {
    return `[${dataset.curriculumRevision} 개정]`;
  }
  if (dataset.academicYear) {
    return `[${dataset.academicYear}]`;
  }
  if (dataset.editionLabel) {
    return `[${dataset.editionLabel}]`;
  }
  return "";
}

export function cataloguedDatasetDisplayLabel(dataset: CataloguedDataset) {
  const displayName =
    dataset.displayName.trim() ||
    datasetDisplayLabel(dataset.title, dataset.edition);
  const prefix = prefixLabel(dataset);
  return prefix && !displayName.startsWith(prefix)
    ? `${prefix} ${displayName}`
    : displayName;
}

export function compareCataloguedDatasets(
  left: CataloguedDataset,
  right: CataloguedDataset,
) {
  const groupDifference =
    DATASET_CATALOG_GROUPS.indexOf(left.catalogGroup) -
    DATASET_CATALOG_GROUPS.indexOf(right.catalogGroup);
  if (groupDifference !== 0) return groupDifference;

  const sortDifference = left.catalogSortIndex - right.catalogSortIndex;
  if (sortDifference !== 0) return sortDifference;

  const yearDifference =
    (right.academicYear ?? -1) - (left.academicYear ?? -1);
  if (yearDifference !== 0) return yearDifference;

  return cataloguedDatasetDisplayLabel(left).localeCompare(
    cataloguedDatasetDisplayLabel(right),
    "ko-KR",
  );
}

export function groupCataloguedDatasets<T extends CataloguedDataset>(
  datasets: readonly T[],
) {
  return DATASET_CATALOG_GROUPS.map((group) => ({
    group,
    label: datasetCatalogGroupLabel(group),
    datasets: datasets
      .filter((dataset) => dataset.catalogGroup === group)
      .toSorted(compareCataloguedDatasets),
  })).filter((section) => section.datasets.length > 0);
}

export function groupCataloguedUnits<
  T extends CataloguedUnit & { id: string; sortIndex: number },
>(units: readonly T[]) {
  const fallbackGroup = units.find((unit) => unit.catalogGroup)?.catalogGroup;
  const orderedGroups = DATASET_CATALOG_GROUPS.filter((group) =>
    units.some((unit) => (unit.catalogGroup ?? fallbackGroup) === group),
  );

  if (orderedGroups.length <= 1) {
    return [{
      group: fallbackGroup ?? null,
      label: fallbackGroup ? datasetCatalogGroupLabel(fallbackGroup) : null,
      units: [...units],
    }];
  }

  return orderedGroups.map((group) => ({
    group,
    label: datasetCatalogGroupLabel(group),
    units: units.filter(
      (unit) => (unit.catalogGroup ?? fallbackGroup) === group,
    ),
  }));
}
