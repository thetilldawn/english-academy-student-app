import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cataloguedDatasetDisplayLabel,
  cataloguedDatasetFromMetadata,
  compareCataloguedDatasets,
  type CataloguedDataset,
} from "@/lib/admin/dataset-catalog";
import type {
  DatasetOption,
  DatasetSummary,
} from "@/lib/admin/dataset-summary";
import {
  queryDatasetCatalogRows,
  type DatasetCatalogRow,
} from "@/lib/services/dataset-catalog-service";

type DatasetSummaryRow = {
  id: string;
  dataset_key: string;
  title: string;
  edition: string | null;
  row_count: number;
  status: DatasetSummary["status"];
  is_active: boolean;
};

export type AdminMaterialSnapshot = {
  allDatasets: DatasetSummary[];
  datasetLabelById: ReadonlyMap<string, string>;
  selectableDatasets: DatasetOption[];
};

function catalogMetadata(catalog: DatasetCatalogRow | undefined) {
  return catalog
    ? {
        displayName: catalog.display_name,
        catalogGroup: catalog.catalog_group,
        materialKind: catalog.material_kind,
        gradeCode: catalog.grade_code,
        publisher: catalog.publisher,
        seriesTitle: catalog.series_title,
        academicYear: catalog.academic_year,
        curriculumRevision: catalog.curriculum_revision,
        editionLabel: catalog.edition_label,
        isAssignable: catalog.is_assignable,
        sortIndex: catalog.sort_index,
      }
    : undefined;
}

function toDatasetOption(dataset: CataloguedDataset): DatasetOption {
  return { ...dataset };
}

export function toSelectableDatasetOptions(
  datasets: readonly DatasetSummary[],
): DatasetOption[] {
  return datasets
    .filter(
      (dataset) =>
        dataset.status === "ready" &&
        dataset.isActive &&
        dataset.isAssignable,
    )
    .map(toDatasetOption);
}

function buildAdminMaterialSnapshot(
  datasetRows: readonly DatasetSummaryRow[],
  catalogRows: readonly DatasetCatalogRow[],
): AdminMaterialSnapshot {
  const catalogByDatasetId = new Map(
    catalogRows.map((catalog) => [catalog.dataset_id, catalog]),
  );
  const allDatasets = datasetRows
    .map((dataset) => ({
      ...cataloguedDatasetFromMetadata(
        dataset,
        catalogMetadata(catalogByDatasetId.get(dataset.id)),
      ),
      datasetKey: dataset.dataset_key,
      rowCount: dataset.row_count,
      status: dataset.status,
      isActive: dataset.is_active,
    }))
    .toSorted(compareCataloguedDatasets);
  const datasetLabelById = new Map(
    allDatasets.map((dataset) => [
      dataset.id,
      cataloguedDatasetDisplayLabel(dataset),
    ]),
  );

  return {
    allDatasets,
    datasetLabelById,
    selectableDatasets: toSelectableDatasetOptions(allDatasets),
  };
}

export async function loadAdminMaterialSnapshot(
  supabase: SupabaseClient,
): Promise<AdminMaterialSnapshot> {
  const [datasetResult, catalogResult] = await Promise.all([
    supabase
      .from("vocab_datasets")
      .select("id, dataset_key, title, edition, row_count, status, is_active")
      .order("title"),
    queryDatasetCatalogRows(supabase),
  ]);

  if (datasetResult.error) {
    throw new Error("단어장 목록을 불러오지 못했습니다.");
  }
  if (catalogResult.failed) {
    throw new Error("단어장 분류 정보를 불러오지 못했습니다.");
  }
  return buildAdminMaterialSnapshot(
    (datasetResult.data ?? []) as DatasetSummaryRow[],
    catalogResult.rows,
  );
}
