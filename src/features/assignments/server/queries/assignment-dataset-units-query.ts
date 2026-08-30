import "server-only";

import type { AssignmentUnitItem } from "../../catalog-types";
import type { AssignmentDatasetUnitsResponse } from "../../contracts/assignment-workspace-read-model";
import {
  cataloguedDatasetFromMetadata,
  type DatasetCatalogGroup,
  type DatasetMaterialKind,
  type VocabUnitType,
} from "@/lib/admin/dataset-catalog";
import type { DatasetSummary } from "@/lib/admin/dataset-summary";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type UnitRow = {
  dataset_id: string;
  entry_count: number;
  id: string;
  sort_index: number;
  unit_kind: "day" | "supplement";
  unit_label: string;
  unit_number: number | null;
};

type UnitCatalogRow = {
  academic_year: number | null;
  agency: string | null;
  catalog_group: DatasetCatalogGroup;
  display_name: string;
  exam_month: number | null;
  item_range: string | null;
  sort_index: number;
  unit_id: string;
  unit_type: VocabUnitType;
};

type DatasetRow = {
  dataset_key: string;
  edition: string | null;
  id: string;
  is_active: boolean;
  row_count: number;
  status: DatasetSummary["status"];
  title: string;
};

type DatasetCatalogRow = {
  academic_year: number | null;
  catalog_group: DatasetCatalogGroup;
  curriculum_revision: string | null;
  display_name: string;
  edition_label: string | null;
  grade_code: string | null;
  is_assignable: boolean;
  material_kind: DatasetMaterialKind;
  publisher: string | null;
  series_title: string | null;
  sort_index: number;
};

export type AssignmentDatasetMaterial = {
  dataset: DatasetSummary;
  units: AssignmentUnitItem[];
};

export class AssignmentDatasetUnitsError extends Error {
  constructor(
    readonly reason: "invalid_dataset" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AssignmentDatasetUnitsError";
  }
}

export async function loadAssignmentDatasetMaterial(
  datasetId: string,
  authenticatedAdmin?: AdminContext,
  access: "assignable" | "historical" = "assignable",
): Promise<AssignmentDatasetMaterial> {
  if (!authenticatedAdmin) await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [datasetResult, catalogResult, unitResult] = await Promise.all([
    supabase
      .from("vocab_datasets")
      .select("id, dataset_key, title, edition, row_count, status, is_active")
      .eq("id", datasetId)
      .maybeSingle(),
    supabase
      .from("vocab_dataset_catalog")
      .select(
        "display_name, catalog_group, material_kind, grade_code, publisher, series_title, academic_year, curriculum_revision, edition_label, is_assignable, sort_index",
      )
      .eq("dataset_id", datasetId)
      .maybeSingle(),
    supabase
      .from("vocab_units")
      .select(
        "id, dataset_id, unit_label, unit_kind, unit_number, sort_index, entry_count",
      )
      .eq("dataset_id", datasetId)
      .order("sort_index"),
  ]);
  if (datasetResult.error || catalogResult.error || unitResult.error) {
    throw new AssignmentDatasetUnitsError(
      "unavailable",
      "시험 범위를 불러오지 못했습니다.",
    );
  }
  const dataset = datasetResult.data as DatasetRow | null;
  const catalog = catalogResult.data as DatasetCatalogRow | null;
  if (
    !dataset ||
    (access === "assignable" &&
      (dataset.status !== "ready" ||
        !dataset.is_active ||
        catalog?.is_assignable === false))
  ) {
    throw new AssignmentDatasetUnitsError(
      "invalid_dataset",
      "현재 배정할 수 없는 단어장입니다.",
    );
  }
  const unitRows = (unitResult.data ?? []) as UnitRow[];
  const unitIds = unitRows.map((unit) => unit.id);
  const unitCatalogResult = unitIds.length === 0
    ? { data: [], error: null }
    : await supabase
        .from("vocab_unit_catalog")
        .select(
          "unit_id, catalog_group, unit_type, display_name, academic_year, exam_month, agency, item_range, sort_index",
        )
        .in("unit_id", unitIds);
  if (unitCatalogResult.error) {
    throw new AssignmentDatasetUnitsError(
      "unavailable",
      "시험 범위 분류를 불러오지 못했습니다.",
    );
  }
  const catalogByUnitId = new Map(
    ((unitCatalogResult.data ?? []) as UnitCatalogRow[]).map((row) => [
      row.unit_id,
      row,
    ]),
  );
  const units: AssignmentUnitItem[] = unitRows.map((unit) => {
    const unitCatalog = catalogByUnitId.get(unit.id);
    return {
      academicYear: unitCatalog?.academic_year ?? null,
      agency: unitCatalog?.agency ?? null,
      catalogGroup: unitCatalog?.catalog_group ?? null,
      catalogSortIndex: unitCatalog?.sort_index ?? unit.sort_index,
      datasetId: unit.dataset_id,
      displayName: unitCatalog?.display_name ?? unit.unit_label,
      entryCount: unit.entry_count,
      examMonth: unitCatalog?.exam_month ?? null,
      id: unit.id,
      itemRange: unitCatalog?.item_range ?? null,
      kind: unit.unit_kind,
      label: unit.unit_label,
      number: unit.unit_number,
      sortIndex: unit.sort_index,
      unitType: unitCatalog?.unit_type ?? null,
    };
  });
  return {
    dataset: {
      ...cataloguedDatasetFromMetadata(
        dataset,
        catalog
          ? {
              academicYear: catalog.academic_year,
              catalogGroup: catalog.catalog_group,
              curriculumRevision: catalog.curriculum_revision,
              displayName: catalog.display_name,
              editionLabel: catalog.edition_label,
              gradeCode: catalog.grade_code,
              isAssignable: catalog.is_assignable,
              materialKind: catalog.material_kind,
              publisher: catalog.publisher,
              seriesTitle: catalog.series_title,
              sortIndex: catalog.sort_index,
            }
          : undefined,
      ),
      datasetKey: dataset.dataset_key,
      isActive: dataset.is_active,
      rowCount: dataset.row_count,
      status: dataset.status,
    },
    units,
  };
}

export async function getAssignmentDatasetUnits(
  datasetId: string,
  authenticatedAdmin?: AdminContext,
): Promise<AssignmentDatasetUnitsResponse> {
  const material = await loadAssignmentDatasetMaterial(
    datasetId,
    authenticatedAdmin,
  );
  return { datasetId, units: material.units };
}
