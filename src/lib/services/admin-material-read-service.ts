import "server-only";

import { cache } from "react";

import { requireAdmin } from "@/lib/auth/admin";
import {
  cataloguedDatasetDisplayLabel,
  cataloguedDatasetFromMetadata,
  compareCataloguedDatasets,
  type CataloguedDataset,
  type DatasetCatalogGroup,
  type VocabUnitType,
} from "@/lib/admin/dataset-catalog";
import type {
  DatasetOption,
  DatasetSummary,
  VocabUnitSummary,
} from "@/lib/admin/dataset-summary";
import { datasetDisplayLabel } from "@/lib/admin/dataset-display";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  queryDatasetCatalogRows,
  type DatasetCatalogRow,
  type RawDataset,
} from "@/lib/services/dataset-catalog-service";

type AdminSupabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type UnitCatalogRow = {
  unit_id: string;
  catalog_group: DatasetCatalogGroup;
  unit_type: VocabUnitType;
  display_name: string;
  academic_year: number | null;
  exam_month: number | null;
  agency: string | null;
  item_range: string | null;
  sort_index: number;
};

type DatasetSummaryRow = {
  id: string;
  dataset_key: string;
  title: string;
  edition: string | null;
  row_count: number;
  status: DatasetSummary["status"];
  is_active: boolean;
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

function mapDatasetSummaries(
  datasets: readonly DatasetSummaryRow[],
  catalogByDatasetId: ReadonlyMap<string, DatasetCatalogRow>,
): DatasetSummary[] {
  return datasets
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

export type AdminMaterialSnapshot = {
  allDatasets: DatasetSummary[];
  datasetLabelById: ReadonlyMap<string, string>;
  selectableDatasets: DatasetOption[];
};

async function queryDatasetSummaryRows(supabase: AdminSupabase) {
  return supabase
    .from("vocab_datasets")
    .select("id, dataset_key, title, edition, row_count, status, is_active")
    .order("title");
}

function buildAdminMaterialSnapshot(
  datasetRows: readonly DatasetSummaryRow[],
  catalogRows: readonly DatasetCatalogRow[],
): AdminMaterialSnapshot {
  const catalogByDatasetId = new Map(
    catalogRows.map((catalog) => [catalog.dataset_id, catalog]),
  );
  const allDatasets = mapDatasetSummaries(datasetRows, catalogByDatasetId);
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
  supabase: AdminSupabase,
): Promise<AdminMaterialSnapshot> {
  const [datasetResult, catalogResult] = await Promise.all([
    queryDatasetSummaryRows(supabase),
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

export async function loadAdminVocabUnits(
  supabase: AdminSupabase,
): Promise<VocabUnitSummary[]> {
  const [unitResult, catalogResult] = await Promise.all([
    supabase
      .from("vocab_units")
      .select(
        "id, dataset_id, unit_label, unit_kind, unit_number, sort_index, entry_count",
      )
      .order("dataset_id")
      .order("sort_index"),
    supabase
      .from("vocab_unit_catalog")
      .select(
        "unit_id, catalog_group, unit_type, display_name, academic_year, exam_month, agency, item_range, sort_index",
      ),
  ]);

  if (unitResult.error || catalogResult.error) {
    throw new Error("단어장 범위 목록을 불러오지 못했습니다.");
  }

  const catalogByUnitId = new Map(
    ((catalogResult.data ?? []) as UnitCatalogRow[]).map((catalog) => [
      catalog.unit_id,
      catalog,
    ]),
  );

  return (unitResult.data ?? []).map((unit) => {
    const catalog = catalogByUnitId.get(unit.id);
    return {
      id: unit.id,
      datasetId: unit.dataset_id,
      label: unit.unit_label,
      kind: unit.unit_kind,
      number: unit.unit_number,
      sortIndex: unit.sort_index,
      entryCount: unit.entry_count,
      catalogGroup: catalog?.catalog_group ?? null,
      unitType: catalog?.unit_type ?? null,
      displayName: catalog?.display_name ?? unit.unit_label,
      academicYear: catalog?.academic_year ?? null,
      examMonth: catalog?.exam_month ?? null,
      agency: catalog?.agency ?? null,
      itemRange: catalog?.item_range ?? null,
      catalogSortIndex: catalog?.sort_index ?? unit.sort_index,
    };
  });
}

const loadAdminMaterialSnapshotForRscRequest = cache(
  async (adminUserId: string): Promise<AdminMaterialSnapshot> => {
    if (!adminUserId) {
      throw new Error("관리자 인증 정보가 필요합니다.");
    }
    const supabase = await createServerSupabaseClient();
    return loadAdminMaterialSnapshot(supabase);
  },
);

const loadAdminVocabUnitsForRscRequest = cache(
  async (adminUserId: string): Promise<VocabUnitSummary[]> => {
    if (!adminUserId) {
      throw new Error("관리자 인증 정보가 필요합니다.");
    }
    const supabase = await createServerSupabaseClient();
    return loadAdminVocabUnits(supabase);
  },
);

/** 같은 React Server Component 렌더 안에서만 공용 자료를 재사용합니다. */
export async function loadCurrentAdminMaterialSnapshotForRsc(): Promise<AdminMaterialSnapshot> {
  const admin = await requireAdmin();
  return loadAdminMaterialSnapshotForRscRequest(admin.userId);
}

/** 이력과 공용 자료가 같은 렌더에서 단어장 분류 조회를 공유합니다. */
export async function loadCurrentAdminDatasetDisplayLabelMapForRsc(
  datasets: readonly RawDataset[],
) {
  const admin = await requireAdmin();
  const snapshot = await loadAdminMaterialSnapshotForRscRequest(admin.userId);
  return new Map(
    datasets.map((dataset) => [
      dataset.id,
      snapshot.datasetLabelById.get(dataset.id) ??
        datasetDisplayLabel(dataset.title, dataset.edition),
    ]),
  );
}

/** 같은 React Server Component 렌더 안에서만 공용 범위를 재사용합니다. */
export async function loadCurrentAdminVocabUnitsForRsc(): Promise<
  VocabUnitSummary[]
> {
  const admin = await requireAdmin();
  return loadAdminVocabUnitsForRscRequest(admin.userId);
}

export async function listDatasets(): Promise<DatasetSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  return (await loadAdminMaterialSnapshot(supabase)).allDatasets;
}

export async function listVocabUnits(): Promise<VocabUnitSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  return loadAdminVocabUnits(supabase);
}
