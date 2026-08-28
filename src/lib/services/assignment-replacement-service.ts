import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  type AssignmentReplacementInput,
  type AssignmentReplacementResult,
} from "@/lib/admin/assignment-edit";
import { assignmentReplacementFingerprintPayload } from "@/lib/admin/assignment-replacement-fingerprint";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  AssignmentReplacementError,
  mapAssignmentReplacementDatabaseFailure,
} from "@/lib/services/assignment-replacement-errors";
import {
  prepareStudentAssignmentReplacement,
} from "@/lib/services/assignment-replacement-preparation-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const replacementResultSchema = z.object({
  status: z.literal("replaced"),
  sourceAssignmentId: z.uuid(),
  replacementAssignmentId: z.uuid(),
  studentId: z.uuid(),
  replacementPurpose: z.enum(["regular", "mixed", "review"]),
  idempotent: z.boolean(),
});

function replacementRequestSha256(
  assignmentId: string,
  studentId: string,
  input: AssignmentReplacementInput,
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        assignmentReplacementFingerprintPayload(
          assignmentId,
          studentId,
          input,
        ),
      ),
      "utf8",
    )
    .digest("hex");
}

async function lookupReplacementResult(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  assignmentId: string,
  studentId: string,
  idempotencyKey: string,
  requestSha256: string,
  input: Pick<
    AssignmentReplacementInput,
    | "availableFrom"
    | "reviewScope"
    | "retryEnabled"
    | "retryPassingScore"
  >,
) {
  const lookup = await supabase.rpc(
    "get_student_assignment_replacement_result_v2",
    {
      p_source_assignment_id: assignmentId,
      p_student_id: studentId,
      p_idempotency_key: idempotencyKey,
      p_request_sha256: requestSha256,
      p_available_from: input.availableFrom,
      p_review_scope: input.reviewScope,
      p_retry_enabled: input.retryEnabled,
      p_retry_passing_score: input.retryPassingScore,
    },
  );
  if (lookup.error) {
    throw mapAssignmentReplacementDatabaseFailure(lookup.error);
  }
  if (lookup.data === null) return null;
  const previous = replacementResultSchema.safeParse(lookup.data);
  if (!previous.success) {
    throw new AssignmentReplacementError("database");
  }
  return previous.data;
}

export async function replaceStudentAssignment(
  assignmentId: string,
  studentId: string,
  input: AssignmentReplacementInput,
  authenticatedAdmin?: AdminContext,
): Promise<AssignmentReplacementResult> {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const supabase = await createServerSupabaseClient();
  const requestSha256 = replacementRequestSha256(
    assignmentId,
    studentId,
    input,
  );
  const replacementMetadata = {
    availableFrom: input.availableFrom,
    reviewScope: input.includePendingReview
      ? input.reviewScope
      : ("dataset" as const),
    retryEnabled: input.retryEnabled,
    retryPassingScore: input.retryPassingScore,
  };
  const previous = await lookupReplacementResult(
    supabase,
    assignmentId,
    studentId,
    input.idempotencyKey,
    requestSha256,
    replacementMetadata,
  );
  if (previous) return previous;

  let replacement: Awaited<
    ReturnType<typeof prepareStudentAssignmentReplacement>
  >;
  try {
    replacement = await prepareStudentAssignmentReplacement(
      assignmentId,
      studentId,
      input,
      admin,
    );
  } catch (error) {
    const concurrentResult = await lookupReplacementResult(
      supabase,
      assignmentId,
      studentId,
      input.idempotencyKey,
      requestSha256,
      replacementMetadata,
    );
    if (concurrentResult) return concurrentResult;
    if (error instanceof AssignmentReplacementError) throw error;
    console.error("[assignment-replacement] preparation failed", error);
    throw new AssignmentReplacementError("database");
  }
  const { replacementKind, reviewSnapshotMode, prepared } =
    replacement;

  const { data, error } = await supabase.rpc(
    "replace_student_assignment_v6",
    {
      p_source_assignment_id: assignmentId,
      p_student_id: studentId,
      p_idempotency_key: input.idempotencyKey,
      p_request_sha256: requestSha256,
      p_replacement_kind: replacementKind,
      p_review_snapshot_mode: reviewSnapshotMode,
      p_title: prepared.title,
      p_dataset_id: prepared.datasetId,
      p_primary_unit_ids: prepared.primaryUnitIds,
      p_question_count: prepared.questionCount,
      p_english_to_korean_ratio: prepared.englishToKoreanRatio,
      p_time_limit_seconds: prepared.timeLimitSeconds,
      p_passing_score: prepared.passingScore,
      p_retry_enabled: prepared.retryEnabled,
      p_retry_passing_score: prepared.retryPassingScore,
      p_question_order_mode: prepared.questionOrderMode,
      p_available_from: prepared.availableFrom,
      p_available_until: prepared.availableUntil,
      p_timing_mode: prepared.timingMode,
      p_question_time_limit_seconds:
        prepared.questionTimeLimitSeconds,
      p_review_levels: prepared.reviewLevels,
      p_review_scope: prepared.reviewScope,
      p_selected_queue_ids: prepared.selectedQueueIds,
      p_questions: prepared.questions,
    },
  );
  if (error) {
    const concurrentResult = await lookupReplacementResult(
      supabase,
      assignmentId,
      studentId,
      input.idempotencyKey,
      requestSha256,
      replacementMetadata,
    );
    if (concurrentResult) return concurrentResult;
    console.error("[assignment-replacement] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw mapAssignmentReplacementDatabaseFailure(error);
  }
  const result = replacementResultSchema.safeParse(data);
  if (!result.success) {
    throw new AssignmentReplacementError("database");
  }
  return result.data;
}
