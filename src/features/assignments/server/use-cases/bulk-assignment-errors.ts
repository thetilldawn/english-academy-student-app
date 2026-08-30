import "server-only";

import { isAssignmentPersistenceInvariantFailure } from "@/lib/admin/assignment-database-error";
import { AssignmentCreationError } from "@/lib/services/regular-assignment-service";
import { MixedAssignmentError } from "@/lib/services/mixed-assignment-service";

export class BulkAssignmentError extends Error {
  constructor(
    public readonly reason:
      | "invalid_selection"
      | "conflict"
      | "database",
    message = "일괄 단어 시험을 배정하지 못했습니다.",
  ) {
    super(message);
    this.name = "BulkAssignmentError";
  }
}

export function mapBulkAssignmentPreparationFailure(error: unknown) {
  if (error instanceof BulkAssignmentError) return error;
  if (error instanceof AssignmentCreationError) {
    return new BulkAssignmentError(error.reason, error.message);
  }
  if (error instanceof MixedAssignmentError) {
    return new BulkAssignmentError(
      error.reason === "database"
        ? "database"
        : error.reason === "conflict"
          ? "conflict"
          : "invalid_selection",
      error.message,
    );
  }
  return new BulkAssignmentError("database");
}

export function bulkDatabaseError(error: { code?: string; message?: string }) {
  const message = error.message ?? "";
  if (
    (error.code === "42883" || error.code === "PGRST202") &&
    message.includes("create_vocab_assignment_queues_v3")
  ) {
    return new BulkAssignmentError(
      "database",
      "요일별 배정 저장 기능을 업데이트하는 중입니다. 잠시 후 다시 배정해 주세요.",
    );
  }
  if (isAssignmentPersistenceInvariantFailure(error)) {
    return new BulkAssignmentError("database");
  }
  if (
    error.code === "40001" ||
    error.code === "23505" ||
    message.includes("snapshot_changed") ||
    message.includes("selection_changed") ||
    message.includes("idempotency_key_reused")
  ) {
    return new BulkAssignmentError(
      "conflict",
      "배정 조건 또는 학생 상태가 바뀌었습니다. 목록을 새로고침한 뒤 다시 배정해 주세요.",
    );
  }
  if (
    message.includes("exam_use_release_inactive") ||
    message.includes("active_exam_use_release_not_found") ||
    message.includes("exam_use_dataset_snapshot_mismatch")
  ) {
    return new BulkAssignmentError(
      "invalid_selection",
      "선택한 단어장의 시험용 데이터가 준비되지 않았습니다. 단어장을 다시 확인해 주세요.",
    );
  }
  if (
    message.includes("capability_unavailable") ||
    message.includes("not_eligible_for_direction") ||
    message.includes("question_plan") ||
    message.includes("question_choices") ||
    message.includes("choice_values_not_distinct")
  ) {
    return new BulkAssignmentError(
      "invalid_selection",
      "선택한 범위에서 현재 시험 방식에 맞는 문제를 만들 수 없습니다. 범위 또는 시험 방식을 확인해 주세요.",
    );
  }
  if (
    message.includes("review_target") ||
    message.includes("review_queue") ||
    message.includes("pending_review")
  ) {
    return new BulkAssignmentError(
      "invalid_selection",
      "포함할 틀린 단어 상태를 다시 확인해 주세요.",
    );
  }
  return new BulkAssignmentError(
    ["22023", "23503"].includes(error.code ?? "")
      ? "invalid_selection"
      : "database",
  );
}
