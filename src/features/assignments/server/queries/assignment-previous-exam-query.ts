import "server-only";

import type { PreviousVocabExamSource } from "../../domain/vocab-previous-exam";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { listAssignmentUnitAllocationRules } from "@/lib/services/vocab-unit-allocation-rule-read-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PreviousExamRow = {
  assignment_id: string;
  assignment_purpose: "regular" | "mixed";
  assignment_title: string;
  assigned_at: string;
  available_from: string | null;
  available_until: string | null;
  dataset_id: string;
  dataset_title: string;
  english_to_korean_ratio: number;
  missed_at: string | null;
  passing_score: number;
  question_order_mode: "fixed" | "ascending" | "descending" | "random";
  question_time_limit_seconds: number | null;
  retry_enabled: boolean;
  retry_passing_score: number | null;
  student_id: string;
  student_name: string;
  time_limit_seconds: number;
  timing_mode: "none" | "total" | "per_question";
};

export class AssignmentPreviousExamError extends Error {
  constructor(message = "최근 시험을 불러오지 못했습니다.") {
    super(message);
    this.name = "AssignmentPreviousExamError";
  }
}

export async function getAssignmentPreviousExam(
  input: { datasetId: string; studentId: string },
  authenticatedAdmin?: AdminContext,
): Promise<PreviousVocabExamSource | null> {
  if (!authenticatedAdmin) await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_admin_assignment_previous_exam_v1",
    {
      p_dataset_id: input.datasetId,
      p_student_id: input.studentId,
    },
  );
  if (error) {
    throw new AssignmentPreviousExamError();
  }
  const row = ((data ?? []) as PreviousExamRow[])[0];
  if (!row) return null;
  if (row.student_id !== input.studentId || row.dataset_id !== input.datasetId) {
    throw new AssignmentPreviousExamError(
      "최근 시험 조회 결과가 선택한 학생·단어장과 다릅니다.",
    );
  }
  const allocationByAssignmentId = await listAssignmentUnitAllocationRules(
    supabase,
    [row.assignment_id],
  );
  return {
    assignmentDeleted: false,
    assignmentId: row.assignment_id,
    assignmentPurpose: row.assignment_purpose,
    assignmentTitle: row.assignment_title,
    assignedAt: row.assigned_at,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    datasetId: row.dataset_id,
    datasetTitle: row.dataset_title,
    englishToKoreanRatio: row.english_to_korean_ratio,
    passingScore: row.passing_score,
    questionOrderMode: row.question_order_mode,
    questionTimeLimitSeconds: row.question_time_limit_seconds,
    retryEnabled: row.retry_enabled,
    retryPassingScore: row.retry_passing_score,
    status: row.missed_at ? "missed" : "not_started",
    studentId: row.student_id,
    studentName: row.student_name,
    timeLimitSeconds: row.time_limit_seconds,
    timingMode: row.timing_mode,
    vocabUnitAllocation:
      allocationByAssignmentId.get(row.assignment_id) ?? null,
  };
}
