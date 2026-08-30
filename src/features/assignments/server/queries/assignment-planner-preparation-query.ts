import "server-only";

import type { AssignmentStudentItem } from "../../catalog-types";
import type { AssignmentPlannerPreparation } from "../../contracts/assignment-workspace-read-model";
import { selectCommonInitialDatasetId } from "../../domain/select-common-initial-dataset";
import { storedDatasetDisplayLabel } from "@/lib/admin/dataset-display";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import {
  loadAdminMaterialSnapshot,
} from "@/lib/services/admin-material-read-service";
import { listVocabTimeTemplates } from "@/lib/services/vocab-time-template-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAssignmentDatasetUnits } from "./assignment-dataset-units-query";

type PlanningStudentRow = {
  current_vocab_book: string | null;
  current_vocab_dataset_id: string | null;
  display_name: string;
  grade_label: string | null;
  id: string;
  school_name: string | null;
  status: "active" | "blocked";
};

export class AssignmentPlannerPreparationError extends Error {
  constructor(
    readonly reason: "invalid_dataset" | "invalid_students" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AssignmentPlannerPreparationError";
  }
}

export async function getAssignmentPlannerPreparation(
  studentIds: readonly string[],
  requestedDatasetId = "",
  authenticatedAdmin?: AdminContext,
): Promise<AssignmentPlannerPreparation> {
  if (!authenticatedAdmin) await requireAdmin();
  const uniqueStudentIds = [...new Set(studentIds)];
  if (uniqueStudentIds.length === 0) {
    throw new AssignmentPlannerPreparationError(
      "invalid_students",
      "배정할 학생을 선택해 주세요.",
    );
  }
  const supabase = await createServerSupabaseClient();
  const [studentResult, material, timeTemplates] =
    await Promise.all([
      supabase
        .from("students")
        .select(
          "id, display_name, school_name, grade_label, current_vocab_book, current_vocab_dataset_id, status",
        )
        .in("id", uniqueStudentIds)
        .is("deleted_at", null),
      loadAdminMaterialSnapshot(supabase),
      listVocabTimeTemplates(),
    ]);
  if (studentResult.error) {
    throw new AssignmentPlannerPreparationError(
      "unavailable",
      "선택 학생 정보를 불러오지 못했습니다.",
    );
  }
  const rows = (studentResult.data ?? []) as PlanningStudentRow[];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const invalidStudentId = uniqueStudentIds.find((studentId) => {
    const row = rowById.get(studentId);
    return !row || row.status !== "active";
  });
  if (invalidStudentId) {
    throw new AssignmentPlannerPreparationError(
      "invalid_students",
      "삭제되었거나 접속 차단된 학생이 포함되어 있습니다. 학생을 다시 선택해 주세요.",
    );
  }
  const students: AssignmentStudentItem[] = uniqueStudentIds.map((studentId) => {
    const row = rowById.get(studentId)!;
    return {
      currentVocabBook:
        (row.current_vocab_dataset_id
          ? material.datasetLabelById.get(row.current_vocab_dataset_id)
          : null) ??
        (row.current_vocab_book
          ? storedDatasetDisplayLabel(row.current_vocab_book)
          : null),
      currentVocabDatasetId: row.current_vocab_dataset_id,
      displayName: row.display_name,
      gradeLabel: row.grade_label,
      id: row.id,
      schoolName: row.school_name,
      status: row.status,
    };
  });
  const readyDatasetIds = new Set(
    material.allDatasets
      .filter(
        (dataset) =>
          dataset.status === "ready" &&
          dataset.isActive &&
          dataset.isAssignable,
      )
      .map((dataset) => dataset.id),
  );
  if (requestedDatasetId && !readyDatasetIds.has(requestedDatasetId)) {
    throw new AssignmentPlannerPreparationError(
      "invalid_dataset",
      "선택한 단어장은 현재 배정할 수 없습니다. 단어장을 다시 선택해 주세요.",
    );
  }
  const initialDatasetId = requestedDatasetId && readyDatasetIds.has(requestedDatasetId)
    ? requestedDatasetId
    : selectCommonInitialDatasetId(students, readyDatasetIds);
  const initialUnits = initialDatasetId
    ? (await getAssignmentDatasetUnits(initialDatasetId, authenticatedAdmin)).units
    : [];

  return {
    datasets: material.allDatasets,
    initialDatasetId,
    initialUnits,
    students,
    timeTemplates,
  };
}
