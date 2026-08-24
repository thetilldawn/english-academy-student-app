export type AssignmentReplacementFailureReason =
  | "forbidden"
  | "not_found"
  | "blocked"
  | "started"
  | "completed"
  | "missed"
  | "cancelled"
  | "deleted"
  | "closed"
  | "deadline_elapsed"
  | "unavailable"
  | "conflict"
  | "invalid_selection"
  | "database";

const failureMessages: Record<
  AssignmentReplacementFailureReason,
  string
> = {
  forbidden: "관리자 권한을 다시 확인해 주세요.",
  not_found: "수정할 학생 배정을 찾지 못했습니다.",
  blocked: "이용이 중지된 학생의 배정은 수정할 수 없습니다.",
  started: "학생이 이미 응시를 시작해 이 배정은 수정할 수 없습니다.",
  completed: "이미 완료되었거나 시간 종료된 시험은 수정할 수 없습니다.",
  missed: "이미 미응시로 마감된 배정은 수정할 수 없습니다.",
  cancelled: "이미 취소된 배정은 수정할 수 없습니다.",
  deleted: "삭제된 학생 또는 시험 배정은 수정할 수 없습니다.",
  closed: "종료된 시험 배정은 수정할 수 없습니다.",
  deadline_elapsed: "응시 시작 마감이 지난 배정은 수정할 수 없습니다.",
  unavailable: "마감되었거나 현재 사용할 수 없는 배정입니다.",
  conflict: "배정 상태가 바뀌었습니다. 새로고침 후 다시 시도해 주세요.",
  invalid_selection: "수정할 시험 범위와 조건을 다시 확인해 주세요.",
  database: "배정을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

export class AssignmentReplacementError extends Error {
  constructor(
    public readonly reason: AssignmentReplacementFailureReason,
    message = failureMessages[reason],
  ) {
    super(message);
    this.name = "AssignmentReplacementError";
  }
}

export function mapAssignmentReplacementDatabaseFailure(error: {
  code?: string;
  message?: string;
}): AssignmentReplacementError {
  const message = error.message ?? "";
  if (error.code === "42501" || /forbidden/.test(message)) {
    return new AssignmentReplacementError("forbidden");
  }
  if (
    error.code === "P0002" ||
    /assignment_student_not_found/.test(message)
  ) {
    return new AssignmentReplacementError("not_found");
  }
  if (/assignment_already_started/.test(message)) {
    return new AssignmentReplacementError("started");
  }
  if (/assignment_already_completed/.test(message)) {
    return new AssignmentReplacementError("completed");
  }
  if (/assignment_already_missed/.test(message)) {
    return new AssignmentReplacementError("missed");
  }
  if (/assignment_already_cancelled/.test(message)) {
    return new AssignmentReplacementError("cancelled");
  }
  if (/student_deleted|assignment_deleted/.test(message)) {
    return new AssignmentReplacementError("deleted");
  }
  if (/student_not_active/.test(message)) {
    return new AssignmentReplacementError("blocked");
  }
  if (/assignment_not_active/.test(message)) {
    return new AssignmentReplacementError("closed");
  }
  if (
    /assignment_unavailable|assignment_deadline_elapsed|assignment_replacement_deadline_elapsed/.test(
      message,
    )
  ) {
    return new AssignmentReplacementError("deadline_elapsed");
  }
  if (/assignment_replacement_persistence_mismatch/.test(message)) {
    return new AssignmentReplacementError("database");
  }
  if (/dataset_not_ready/.test(message)) {
    return new AssignmentReplacementError("unavailable");
  }
  if (
    error.code === "40001" ||
    /idempotency_key_reused|snapshot_changed|already_active/.test(message)
  ) {
    return new AssignmentReplacementError(
      "conflict",
      /idempotency_key_reused/.test(message)
        ? "같은 수정 요청 키에 다른 조건이 사용되었습니다. 다시 열어 시도해 주세요."
        : failureMessages.conflict,
    );
  }
  if (error.code === "21000") {
    return new AssignmentReplacementError("database");
  }
  if (["22023", "23503", "23505"].includes(error.code ?? "")) {
    return new AssignmentReplacementError("invalid_selection");
  }
  return new AssignmentReplacementError("database");
}
