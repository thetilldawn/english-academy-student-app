import "server-only";

import type { DatasetSummary, VocabUnitSummary } from "@/lib/admin/dataset-summary";
import type { AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  AssignmentDatasetUnitsError,
  loadAssignmentDatasetMaterial,
} from "./assignment-dataset-units-query";

export type BulkPlanningStudent = {
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
  current_vocab_dataset_id: string | null;
  display_name: string;
  id: string;
  status: "active" | "blocked";
};

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
      .select("id, display_name, status, current_vocab_dataset_id")
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
