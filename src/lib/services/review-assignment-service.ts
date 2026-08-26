import "server-only";

import { z } from "zod";

import {
  isAssignmentPersistenceInvariantFailure,
} from "@/lib/admin/assignment-database-error";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  createTargetedQuizQuestions,
} from "@/lib/quiz/question-generator";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { loadReviewDraftContext } from "@/lib/services/review-assignment-draft-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ExactReviewAssignmentInput = {
  reviewDraftId: string;
  title: string;
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  timingMode?: TimingMode;
  questionTimeLimitSeconds?: number | null;
  passingScore: number;
  questionOrderMode: QuestionOrderMode;
  availableUntil: string | null;
};

export class ReviewAssignmentError extends Error {
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
    this.name = "ReviewAssignmentError";
  }
}

export class ReviewAssignmentDraftCancelError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "not_found"
      | "unavailable"
      | "database",
  ) {
    super("오답 시험 준비를 취소하지 못했습니다.");
    this.name = "ReviewAssignmentDraftCancelError";
  }
}

export async function cancelStudentReviewAssignmentDraft(
  studentId: string,
  reviewDraftId: string,
  authenticatedAdmin?: AdminContext,
) {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "cancel_student_vocab_review_assignment_draft",
    {
      p_student_id: studentId,
      p_review_draft_id: reviewDraftId,
    },
  );

  if (error) {
    console.error("[review-assignment-draft-cancel] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw new ReviewAssignmentDraftCancelError(
      error.code === "42501"
        ? "forbidden"
        : error.code === "P0002"
          ? "not_found"
          : error.code === "40001"
            ? "unavailable"
            : "database",
    );
  }

  if (data !== "cancelled") {
    throw new ReviewAssignmentDraftCancelError("database");
  }

  return data;
}

export async function createExactReviewAssignment(
  input: ExactReviewAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<string> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= Date.now()
  ) {
    throw new ReviewAssignmentError("invalid_selection");
  }

  const supabase = await createServerSupabaseClient();
  const context = await loadReviewDraftContext(
    supabase,
    input.reviewDraftId,
  );
  if (!context) {
    throw new ReviewAssignmentError("unavailable");
  }

  const candidates = await loadEligibleVocabularyDataset(
    supabase,
    context.summary.datasetId,
  );
  const candidateById = new Map(
    candidates.map((entry) => [entry.id, entry]),
  );
  const targets = context.targetEntryIds.flatMap((entryId) => {
    const entry = candidateById.get(entryId);
    return entry ? [entry] : [];
  });
  if (targets.length !== context.targetEntryIds.length) {
    throw new ReviewAssignmentError("invalid_selection");
  }

  let questionDrafts;
  try {
    questionDrafts = createTargetedQuizQuestions(
      targets,
      candidates,
      input.englishToKoreanRatio,
    );
  } catch {
    throw new ReviewAssignmentError("invalid_selection");
  }

  const { data, error } = await supabase.rpc(
    "create_exact_review_assignment_v4",
    {
      p_review_draft_id: input.reviewDraftId,
      p_title: input.title || context.summary.generatedTitle,
      p_english_to_korean_ratio: input.englishToKoreanRatio,
      p_time_limit_seconds: input.timeLimitSeconds,
      p_passing_score: input.passingScore,
      p_question_order_mode: input.questionOrderMode,
      p_available_until: input.availableUntil,
      p_questions: questionDrafts.map((question, index) => ({
        vocab_entry_id: question.vocabEntryId,
        base_order_index: index + 1,
        direction: question.direction,
        choice_vocab_entry_ids: question.choiceVocabEntryIds,
      })),
    },
  );

  if (error) {
    console.error("[exact-review-assignment] database operation failed", {
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
    throw new ReviewAssignmentError(reason);
  }
  if (!z.uuid().safeParse(data).success) {
    throw new ReviewAssignmentError("database");
  }
  const assignmentId = data as string;
  const { error: deliveryError } = await supabase.rpc(
    "configure_assignment_delivery_v1",
    {
      p_assignment_id: assignmentId,
      p_timing_mode: input.timingMode ?? "total",
      p_question_time_limit_seconds:
        input.timingMode === "per_question"
          ? (input.questionTimeLimitSeconds ?? null)
          : null,
    },
  );
  if (deliveryError) {
    await supabase
      .from("assignments")
      .update({ status: "closed" })
      .eq("id", assignmentId);
    throw new ReviewAssignmentError("database");
  }
  return assignmentId;
}
