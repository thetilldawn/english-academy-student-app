import "server-only";

import {
  parseDirectReviewCandidates,
  parseDirectReviewDatasetSummaries,
  type DirectReviewCandidate,
  type DirectReviewCandidateRow,
  type DirectReviewDatasetSummary,
  type DirectReviewDatasetSummaryRow,
} from "@/lib/admin/direct-review-candidate";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

export class DirectReviewCandidateError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "unavailable"
      | "invalid_selection"
      | "database",
    message = "현재 오답 시험 후보를 불러오지 못했습니다.",
  ) {
    super(message);
    this.name = "DirectReviewCandidateError";
  }
}

function candidateError(error: { code?: string; message?: string } | null) {
  if (error?.code === "42501") {
    return new DirectReviewCandidateError("forbidden");
  }
  if (error?.code === "22023") {
    return new DirectReviewCandidateError(
      /student_not_active/.test(error.message ?? "")
        ? "unavailable"
        : "invalid_selection",
    );
  }
  return new DirectReviewCandidateError("database");
}

export async function listStudentDirectReviewDatasetSummaries(
  studentId: string,
  authenticatedAdmin?: AdminContext,
  client?: ServerSupabaseClient,
): Promise<DirectReviewDatasetSummary[]> {
  if (!authenticatedAdmin) await requireAdmin();
  const supabase = client ?? await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_student_direct_review_dataset_summaries_v1",
    { p_student_id: studentId },
  );
  if (error || !Array.isArray(data)) throw candidateError(error);
  try {
    return parseDirectReviewDatasetSummaries(
      data as DirectReviewDatasetSummaryRow[],
    );
  } catch {
    throw new DirectReviewCandidateError("database");
  }
}

export async function listStudentDirectReviewCandidates(
  {
    datasetId,
    limit = 400,
    reviewLevels,
    studentId,
  }: {
    datasetId: string;
    limit?: number;
    reviewLevels: readonly (1 | 2)[];
    studentId: string;
  },
  authenticatedAdmin?: AdminContext,
  client?: ServerSupabaseClient,
): Promise<DirectReviewCandidate[]> {
  if (!authenticatedAdmin) await requireAdmin();
  const supabase = client ?? await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_student_direct_review_candidates_v1",
    {
      p_student_id: studentId,
      p_dataset_id: datasetId,
      p_review_levels: [...reviewLevels],
      p_limit: limit,
    },
  );
  if (error || !Array.isArray(data)) throw candidateError(error);
  try {
    return parseDirectReviewCandidates(data as DirectReviewCandidateRow[]);
  } catch {
    throw new DirectReviewCandidateError("database");
  }
}
