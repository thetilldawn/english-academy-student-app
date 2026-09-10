import "server-only";

import type { DatasetSummary, VocabUnitSummary } from "@/lib/admin/dataset-summary";
import type { AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  AssignmentDatasetUnitsError,
  loadAssignmentDatasetMaterial,
} from "./assignment-dataset-units-query";

export type BulkPlanningStudent = {
  gradeLabel?: string | null;
  currentVocabDatasetId: string | null;
  displayName: string;
  id: string;
  status: "active" | "blocked";
};

export type CommonBulkAssignmentPlanningData = {
  dataset: DatasetSummary | null;
  students: BulkPlanningStudent[];
  units: VocabUnitSummary[];
};

type PlanningStudentRow = {
  grade_label?: string | null;
  current_vocab_dataset_id: string | null;
  display_name: string;
  id: string;
  status: "active" | "blocked";
};

/** Call only after the existing admin/material/selected-unit checks. No rows leave the server. */
export async function loadSelectedVocabularyRowCount(datasetId: string, unitIds: readonly string[]): Promise<number | null> {
  if (unitIds.length === 0) return null;
  try {
    const client = await createServerSupabaseClient();
    const result = await client.from("vocab_entries")
      .select("id", { count: "exact", head: true })
      .eq("dataset_id", datasetId).in("unit_id", [...unitIds]);
    return !result.error && Number.isSafeInteger(result.count) && result.count! >= 0
      ? result.count : null;
  } catch {
    // Optional diagnostics fail visibly; do not turn a failed count into zero.
    return null;
  }
}

export class BulkAssignmentPlanningQueryError extends Error {
  constructor(message = "배정 검토 자료를 불러오지 못했습니다.") {
    super(message);
    this.name = "BulkAssignmentPlanningQueryError";
  }
}

async function loadOptionalPlanningMaterial(
  datasetId: string,
  authenticatedAdmin: AdminContext,
) {
  try {
    return await loadAssignmentDatasetMaterial(
      datasetId,
      authenticatedAdmin,
      "historical",
    );
  } catch (error) {
    if (
      error instanceof AssignmentDatasetUnitsError &&
      error.reason === "invalid_dataset"
    ) {
      return { dataset: null, units: [] };
    }

    throw error;
  }
}

export async function loadCommonBulkAssignmentPlanningData(
  input: {
    datasetId: string;
    studentIds: readonly string[];
  },
  authenticatedAdmin: AdminContext,
): Promise<CommonBulkAssignmentPlanningData> {
  const studentIds = [...new Set(input.studentIds)];
  const supabase = await createServerSupabaseClient();
  const [studentResult, material] = await Promise.all([
    supabase
      .from("students")
      .select("id, display_name, status, current_vocab_dataset_id, grade_label")
      .in("id", studentIds)
      .is("deleted_at", null),
    loadOptionalPlanningMaterial(input.datasetId, authenticatedAdmin),
  ]);

  if (studentResult.error) {
    throw new BulkAssignmentPlanningQueryError();
  }

  const students = ((studentResult.data ?? []) as PlanningStudentRow[]).map(
    (row) => ({
      currentVocabDatasetId: row.current_vocab_dataset_id,
      gradeLabel: row.grade_label ?? null,
      displayName: row.display_name,
      id: row.id,
      status: row.status,
    }),
  );

  return {
    dataset: material.dataset,
    students,
    units: material.units,
  };
}
