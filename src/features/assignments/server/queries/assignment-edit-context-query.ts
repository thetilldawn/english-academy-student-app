import "server-only";

import type { AssignmentEditContext } from "../../contracts/assignment-workspace-read-model";
import { storedDatasetDisplayLabel } from "@/lib/admin/dataset-display";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { loadAdminMaterialSnapshot } from "@/lib/services/admin-material-read-service";
import { getStudentAssignmentEditDraft } from "@/lib/services/assignment-edit-source-service";
import { AssignmentReplacementError } from "@/lib/services/assignment-replacement-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadAssignmentDatasetMaterial } from "./assignment-dataset-units-query";

type EditStudentRow = {
  current_vocab_book: string | null;
  current_vocab_dataset_id: string | null;
  deleted_at: string | null;
  display_name: string;
  grade_label: string | null;
  id: string;
  school_name: string | null;
  status: "active" | "blocked";
};

export class AssignmentEditContextError extends Error {
  constructor(
    readonly reason:
      | "invalid_selection"
      | "invalid_target"
      | "not_found"
      | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AssignmentEditContextError";
  }
}

export async function getAssignmentEditContext(
  input: { assignmentId: string; studentId: string },
  authenticatedAdmin?: AdminContext,
): Promise<AssignmentEditContext> {
  const admin = authenticatedAdmin ?? await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [studentResult, material, initialEditDraft] = await (async () => {
    try {
      return await Promise.all([
        supabase
          .from("students")
          .select(
            "id, display_name, school_name, grade_label, current_vocab_book, current_vocab_dataset_id, status, deleted_at",
          )
          .eq("id", input.studentId)
          .maybeSingle(),
        loadAdminMaterialSnapshot(supabase),
        getStudentAssignmentEditDraft(
          input.assignmentId,
          input.studentId,
          admin,
          { nowMilliseconds: Date.now() },
        ),
      ]);
    } catch (error) {
      if (error instanceof AssignmentReplacementError) {
        const reason = error.reason === "database"
          ? "unavailable"
          : error.reason === "not_found"
            ? "not_found"
            : error.reason === "invalid_selection"
              ? "invalid_selection"
              : "invalid_target";
        throw new AssignmentEditContextError(
          reason,
          error.message,
        );
      }
      throw error;
    }
  })();
  if (studentResult.error) {
    throw new AssignmentEditContextError(
      "unavailable",
      "수정 준비 자료를 불러오지 못했습니다.",
    );
  }
  const studentRow = studentResult.data as EditStudentRow | null;
  if (
    !studentRow ||
    studentRow.deleted_at !== null ||
    studentRow.status !== "active"
  ) {
    throw new AssignmentEditContextError(
      "invalid_target",
      "현재 수정할 수 없는 시험입니다.",
    );
  }
  const initialDatasetId = initialEditDraft.datasetId;
  if (
    !material.allDatasets.some((dataset) => dataset.id === initialDatasetId)
  ) {
    throw new AssignmentEditContextError(
      "invalid_target",
      "원래 시험의 단어장을 확인할 수 없습니다.",
    );
  }
  const units = (
    await loadAssignmentDatasetMaterial(
      initialDatasetId,
      admin,
      "historical",
    )
  ).units;
  const unitIds = new Set(units.map((unit) => unit.id));
  if (initialEditDraft.primaryUnitIds.some((unitId) => !unitIds.has(unitId))) {
    throw new AssignmentEditContextError(
      "invalid_target",
      "원래 시험 범위를 확인할 수 없습니다.",
    );
  }
  const initialUnitIds = [...initialEditDraft.primaryUnitIds];

  return {
    datasets: material.allDatasets,
    initialEditDraft,
    initialDatasetId,
    initialUnitIds,
    progress: null,
    student: {
      currentVocabBook:
        (studentRow.current_vocab_dataset_id
          ? material.datasetLabelById.get(studentRow.current_vocab_dataset_id)
          : null) ??
        (studentRow.current_vocab_book
          ? storedDatasetDisplayLabel(studentRow.current_vocab_book)
          : null),
      currentVocabDatasetId: studentRow.current_vocab_dataset_id,
      displayName: studentRow.display_name,
      gradeLabel: studentRow.grade_label,
      id: studentRow.id,
      schoolName: studentRow.school_name,
      status: studentRow.status,
    },
    units,
  };
}
