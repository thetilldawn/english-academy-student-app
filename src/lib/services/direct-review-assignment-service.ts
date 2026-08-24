import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { isAssignmentPersistenceInvariantFailure } from "@/lib/admin/assignment-database-error";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import {
  calculateDirectReviewPreview,
  DirectReviewPreparationError,
  prepareDirectReviewAssignmentBatch,
} from "@/lib/services/direct-review-preparation-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  DirectReviewAssignmentInput,
  DirectReviewPreviewInput,
} from "@/lib/admin/direct-review-assignment-request";

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

function directReviewRequestSha256(input: DirectReviewAssignmentInput) {
  return createHash("sha256")
    .update(JSON.stringify({
      studentId: input.studentId,
      datasetId: input.datasetId,
      reviewLevels: [...input.reviewLevels].toSorted(),
      totalQuestionCount: input.totalQuestionCount,
      title: input.title,
      englishToKoreanRatio: input.englishToKoreanRatio,
      timeLimitSeconds: input.timeLimitSeconds,
      passingScore: input.passingScore,
      retryEnabled: input.retryEnabled,
      retryPassingScore: input.retryPassingScore,
      questionOrderMode: input.questionOrderMode,
      availableUntil: input.availableUntil,
      timingMode: input.timingMode ?? "total",
      questionTimeLimitSeconds: input.questionTimeLimitSeconds ?? null,
    }), "utf8")
    .digest("hex");
}

function mapPreparationError(error: DirectReviewPreparationError) {
  return new DirectReviewAssignmentError(error.reason, error.message);
}

export async function previewDirectReviewAssignment(
  input: DirectReviewPreviewInput,
  authenticatedAdmin?: AdminContext,
) {
  const admin = authenticatedAdmin ?? await requireAdmin();
  const supabase = await createServerSupabaseClient();
  try {
    return await calculateDirectReviewPreview(
      input,
      admin,
      supabase,
    );
  } catch (error) {
    if (error instanceof DirectReviewPreparationError) {
      throw mapPreparationError(error);
    }
    throw error;
  }
}

export async function createDirectReviewAssignment(
  input: DirectReviewAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  const admin = authenticatedAdmin ?? await requireAdmin();

  const supabase = await createServerSupabaseClient();
  const requestSha256 = directReviewRequestSha256(input);
  const previous = await supabase.rpc(
    "get_current_wrong_review_assignment_result_v1",
    {
      p_student_id: input.studentId,
      p_dataset_id: input.datasetId,
      p_idempotency_key: input.idempotencyKey,
      p_request_sha256: requestSha256,
    },
  );
  if (previous.error) {
    throw new DirectReviewAssignmentError(
      previous.error.code === "42501"
        ? "forbidden"
        : previous.error.code === "23505"
          ? "conflict"
          : "database",
    );
  }
  if (previous.data !== null) {
    if (!z.uuid().safeParse(previous.data).success) {
      throw new DirectReviewAssignmentError("database");
    }
    return previous.data as string;
  }

  let prepared;
  try {
    prepared = await prepareDirectReviewAssignmentBatch(
      input,
      admin,
      supabase,
    );
  } catch (error) {
    if (error instanceof DirectReviewPreparationError) {
      throw mapPreparationError(error);
    }
    throw error;
  }

  const queueCount = prepared.sourceQuestionIds.length;
  const questionCount = prepared.questions.length;
  if (
    queueCount !== input.totalQuestionCount ||
    questionCount !== input.totalQuestionCount ||
    new Set(prepared.questions.map((question) => question.vocab_entry_id)).size !==
      questionCount
  ) {
    throw new DirectReviewAssignmentError(
      "conflict",
      "오답 목록이 바뀌었습니다. 단어 수를 다시 확인해 주세요.",
    );
  }

  const { data, error } = await supabase.rpc(
    "create_current_wrong_review_assignment_v1",
    {
      p_student_id: prepared.studentId,
      p_dataset_id: prepared.datasetId,
      p_review_levels: prepared.reviewLevels,
      p_source_question_ids: prepared.sourceQuestionIds,
      p_idempotency_key: input.idempotencyKey,
      p_request_sha256: requestSha256,
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
        : error.code === "40001" || error.code === "23505"
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
