import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { datasetDisplayLabel } from "@/lib/admin/dataset-display";
import {
  cataloguedDatasetFromMetadata,
  cataloguedDatasetDisplayLabel,
  type DatasetCatalogGroup,
  type DatasetMaterialKind,
} from "@/lib/admin/dataset-catalog";

export type RawDataset = {
  id: string;
  title: string;
  edition?: string | null;
};

export type DatasetCatalogRow = {
  dataset_id: string;
  display_name: string;
  catalog_group: DatasetCatalogGroup;
  material_kind: DatasetMaterialKind;
  grade_code: string | null;
  publisher: string | null;
  series_title: string | null;
  academic_year: number | null;
  curriculum_revision: string | null;
  edition_label: string | null;
  is_assignable: boolean;
  sort_index: number;
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

export async function queryDatasetCatalogRows(
  supabase: SupabaseClient,
  datasetIds?: readonly string[],
) {
  let query = supabase
    .from("vocab_dataset_catalog")
    .select(
      "dataset_id, display_name, catalog_group, material_kind, grade_code, publisher, series_title, academic_year, curriculum_revision, edition_label, is_assignable, sort_index",
    );
  const uniqueDatasetIds = datasetIds
    ? [...new Set(datasetIds)]
    : undefined;
  if (uniqueDatasetIds) {
    query = query.in("dataset_id", uniqueDatasetIds);
  }
  const { data, error } = await query;

  return {
    rows: (data ?? []) as DatasetCatalogRow[],
    failed: Boolean(error),
  };
}

export function buildDatasetDisplayLabelMap(
  datasets: readonly RawDataset[],
  catalogRows: readonly DatasetCatalogRow[] | null,
) {
  if (datasets.length === 0) return new Map<string, string>();

  if (catalogRows === null) {
    return new Map(
      datasets.map((dataset) => [
        dataset.id,
        datasetDisplayLabel(dataset.title, dataset.edition),
      ]),
    );
  }

  const catalogById = new Map(
    catalogRows.map((row) => [row.dataset_id, row]),
  );
  return new Map(
    datasets.map((dataset) => [
      dataset.id,
      cataloguedDatasetDisplayLabel(
        cataloguedDatasetFromMetadata(
          dataset,
          catalogMetadata(catalogById.get(dataset.id)),
        ),
      ),
    ]),
  );
}

export async function loadDatasetDisplayLabelMap(
  supabase: SupabaseClient,
  datasets: readonly RawDataset[],
) {
  const datasetIds = [...new Set(datasets.map((dataset) => dataset.id))];
  if (datasetIds.length === 0) return new Map<string, string>();
  const catalog = await queryDatasetCatalogRows(supabase, datasetIds);
  return buildDatasetDisplayLabelMap(
    datasets,
    catalog.failed ? null : catalog.rows,
  );
}

export async function loadDatasetDisplayLabel(
  supabase: SupabaseClient,
  dataset: RawDataset,
) {
  const labels = await loadDatasetDisplayLabelMap(supabase, [dataset]);
  return (
    labels.get(dataset.id) ??
    datasetDisplayLabel(dataset.title, dataset.edition)
  );
}
