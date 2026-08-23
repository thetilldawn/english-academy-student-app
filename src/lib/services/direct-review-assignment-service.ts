import "server-only";

import { z } from "zod";

import { isAssignmentPersistenceInvariantFailure } from "@/lib/admin/assignment-database-error";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import {
  MixedAssignmentError,
  prepareDirectReviewAssignmentBatch,
} from "@/lib/services/mixed-assignment-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { DirectReviewAssignmentInput } from "@/lib/validation";

export class DirectReviewAssignmentError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "unavailable"
      | "invalid_selection"
      | "conflict"
      | "database",
    message = "오답 시험을 배정하지 못했습니다.",
  ) {
    super(message);
    this.name = "DirectReviewAssignmentError";
  }
}

export async function createDirectReviewAssignment(
  input: DirectReviewAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  if (!authenticatedAdmin) await requireAdmin();

  let prepared;
  try {
    prepared = await prepareDirectReviewAssignmentBatch(
      input,
      authenticatedAdmin,
    );
  } catch (error) {
    if (error instanceof MixedAssignmentError) {
      throw new DirectReviewAssignmentError(error.reason, error.message);
    }
    throw error;
  }

  const queueCount = prepared.selectedQueueIds.length;
  const questionCount = prepared.questions.length;
  if (
    queueCount !== input.totalQuestionCount ||
    questionCount !== input.totalQuestionCount ||
    new Set(prepared.questions.map((question) => question.vocab_entry_id)).size !==
      questionCount
  ) {
    throw new DirectReviewAssignmentError(
      "conflict",
      "오답 목록이 바뀌었습니다. 문항 수를 다시 확인해 주세요.",
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "create_exact_review_assignment_v7",
    {
      p_student_id: prepared.studentId,
      p_dataset_id: prepared.datasetId,
      p_selected_queue_ids: prepared.selectedQueueIds,
      p_title: prepared.title,
      p_english_to_korean_ratio: prepared.englishToKoreanRatio,
      p_time_limit_seconds: prepared.timeLimitSeconds,
      p_passing_score: prepared.passingScore,
      p_retry_enabled: prepared.retryEnabled,
      p_retry_passing_score: prepared.retryPassingScore,
      p_question_order_mode: prepared.questionOrderMode,
      p_available_until: prepared.availableUntil,
      p_timing_mode: prepared.timingMode,
      p_question_time_limit_seconds: prepared.questionTimeLimitSeconds,
      p_questions: prepared.questions,
    },
  );

  if (error) {
    console.error("[direct-review-assignment] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    const reason = isAssignmentPersistenceInvariantFailure(error)
      ? "database"
      : error.code === "42501"
        ? "forbidden"
        : error.code === "40001"
          ? "conflict"
          : ["22023", "P0002", "23503", "23505"].includes(error.code)
            ? "invalid_selection"
            : "database";
    throw new DirectReviewAssignmentError(reason);
  }
  if (!z.uuid().safeParse(data).success) {
    throw new DirectReviewAssignmentError("database");
  }
  return data as string;
}
