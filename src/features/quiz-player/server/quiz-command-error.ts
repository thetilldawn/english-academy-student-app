import type { QuizCommandFailure } from "../model";

export class QuizCommandError extends Error {
  constructor(public readonly status: number, public readonly payload: QuizCommandFailure) {
    super(payload.error);
  }
}

/** Only an actual RPC error with a known abort proves the transaction failed. */
export function quizExpirationError(error: { code?: string; message?: string }): QuizCommandError {
  const name = error.message?.split(/[\s:]/)[0];
  if (error.code === "42501") return new QuizCommandError(403, {
    error: "다시 로그인해 주세요.", code: "authentication_required", retryable: false, outcome: "not_applied",
  });
  if (["attempt_not_found", "practice_not_found"].includes(name ?? "")) return new QuizCommandError(404, {
    error: "시험을 찾을 수 없습니다.", code: "attempt_not_found", retryable: false, outcome: "not_applied",
  });
  // Legacy business exceptions can use 40001 too; classify them before SQLSTATE.
  if (["attempt_not_expired", "attempt_not_active", "attempt_phase_mismatch", "attempt_review_not_timed", "quiz_not_expired",
    "practice_expire_too_early", "practice_already_finished"].includes(name ?? "")) return new QuizCommandError(409, {
    error: "시험 상태를 다시 확인해 주세요.", code: "attempt_state_changed", retryable: false, outcome: "not_applied",
  });
  if (error.code === "PT409") return new QuizCommandError(409, {
    error: "시험 상태를 다시 확인해 주세요.", code: "attempt_state_changed", retryable: false, outcome: "not_applied",
  });
  if (["57014", "40P01", "40001", "55P03"].includes(error.code ?? "")) return new QuizCommandError(503, {
    error: "시험 종료를 저장하지 못했습니다. 잠시 뒤 다시 확인합니다.",
    code: "temporary_database_failure", retryable: true, outcome: "not_applied",
  });
  return new QuizCommandError(503, {
    error: "시험 종료가 저장됐는지 확인하지 못했습니다.", code: "expiration_unconfirmed", retryable: false, outcome: "unknown",
  });
}

export function quizAnswerError(error: { code?: string; message?: string }): QuizCommandError {
  const name = error.message?.split(/[\s:]/)[0];
  if (["invalid_phase", "question_time_remaining", "question_not_found", "question_not_ready", "attempt_phase_mismatch",
    "practice_answer_conflict", "practice_answer_outdated", "practice_question_not_ready", "practice_timeout_too_early"].includes(name ?? "")) {
    return new QuizCommandError(409, { error: "문제 상태를 다시 확인해 주세요.", code: "question_state_changed", retryable: false, outcome: "not_applied" });
  }
  const failure = quizExpirationError(error);
  if (failure.status < 500) return failure;
  return new QuizCommandError(failure.status, { ...failure.payload, error: "답안 저장을 확인하지 못했습니다. 다시 확인해 주세요." });
}

export function quizCommandErrorResponse(error: unknown, operation: "expiration" | "answer" = "expiration"): Response {
  const failure = error instanceof QuizCommandError ? error : operation === "answer" ? quizAnswerError({}) : quizExpirationError({});
  return Response.json(failure.payload, { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
}
