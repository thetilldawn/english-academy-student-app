import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cataloguedDatasetDisplayLabel,
  type CataloguedDataset,
  type DatasetCatalogGroup,
  type DatasetMaterialKind,
} from "@/lib/admin/dataset-catalog";
import { datasetDisplayLabel } from "@/lib/admin/dataset-display";

type RawDataset = {
  id: string;
  title: string;
  edition?: string | null;
};

type CatalogRow = {
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

function toCataloguedDataset(
  dataset: RawDataset,
  catalog: CatalogRow | undefined,
): CataloguedDataset {
  return {
    id: dataset.id,
    title: dataset.title,
    edition: dataset.edition ?? null,
    displayName:
      catalog?.display_name ??
      datasetDisplayLabel(dataset.title, dataset.edition),
    catalogGroup: catalog?.catalog_group ?? "high",
    materialKind: catalog?.material_kind ?? null,
    gradeCode: catalog?.grade_code ?? null,
    publisher: catalog?.publisher ?? null,
    seriesTitle: catalog?.series_title ?? null,
    academicYear: catalog?.academic_year ?? null,
    curriculumRevision: catalog?.curriculum_revision ?? null,
    editionLabel: catalog?.edition_label ?? null,
    isAssignable: catalog?.is_assignable ?? true,
    catalogSortIndex: catalog?.sort_index ?? 1000,
  };
}

export async function loadDatasetDisplayLabelMap(
  supabase: SupabaseClient,
  datasets: readonly RawDataset[],
) {
  const datasetIds = [...new Set(datasets.map((dataset) => dataset.id))];
  if (datasetIds.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("vocab_dataset_catalog")
    .select(
      "dataset_id, display_name, catalog_group, material_kind, grade_code, publisher, series_title, academic_year, curriculum_revision, edition_label, is_assignable, sort_index",
    )
    .in("dataset_id", datasetIds);

  if (error) {
    return new Map(
      datasets.map((dataset) => [
        dataset.id,
        datasetDisplayLabel(dataset.title, dataset.edition),
      ]),
    );
  }

  const rows = (data ?? []) as CatalogRow[];
  const catalogById = new Map(rows.map((row) => [row.dataset_id, row]));
  return new Map(
    datasets.map((dataset) => [
      dataset.id,
      cataloguedDatasetDisplayLabel(
        toCataloguedDataset(dataset, catalogById.get(dataset.id)),
      ),
    ]),
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
