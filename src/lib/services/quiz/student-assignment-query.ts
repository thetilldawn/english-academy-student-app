import "server-only";

import type { StudentAssignmentSummary } from "@/features/student-dashboard/model";
import {
  assignmentDisplayTitleForUnits,
  assignmentScopeLabel,
  type AssignmentPurpose,
} from "@/lib/admin/history";
import type { QuestionOrderMode, TimingMode } from "@/lib/admin/assignment-settings";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { loadDatasetDisplayLabelMap } from "../dataset-catalog-service";
import { finalizeStudentMissedAssignments } from "../missed-assignment-service";
import { finalizeStaleQuizAttempts } from "../stale-attempt-service";
import { materializeReadyVocabAssignmentQueue } from "../vocab-assignment-queue-service";

type AssignmentRow = {
  id: string;
  title: string;
  assignment_purpose: AssignmentPurpose;
  dataset_id: string;
  range_start: number;
  range_end: number;
  question_count: number;
  english_to_korean_ratio: number;
  time_limit_seconds: number;
  passing_score: number;
  retake_allowed: boolean;
  range_basis: "source_rows" | "units";
  question_bank_version: number | null;
  question_order_mode: QuestionOrderMode;
  timing_mode: TimingMode;
  question_time_limit_seconds: number | null;
  status: "draft" | "active" | "closed";
  available_from: string | null;
  available_until: string | null;
};

type AttemptRow = {
  id: string;
  assignment_id: string;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  attempt_number: number;
  started_at: string;
  initial_completed_at: string | null;
  deadline_at: string;
  completed_at: string | null;
  unresolved_wrong_count: number | null;
  current_question_started_at: string;
  initial_score: number | string | null;
  final_score: number | string | null;
  passed: boolean | null;
  retry_started_at: string | null;
};

export async function listStudentAssignments(
  studentId: string,
): Promise<StudentAssignmentSummary[]> {
  const [, missedFinalization] = await Promise.all([
    finalizeStaleQuizAttempts(),
    finalizeStudentMissedAssignments(studentId),
  ]);
  // A stale-attempt finalizer may complete the current queued exam and mark
  // the next step ready. Materialize only after both finalizers commit so the
  // newly-ready step is not missed by a racing read.
  await materializeReadyVocabAssignmentQueue(studentId);
  if (missedFinalization.batchLimitReached) {
    console.warn("[missed-assignment] student batch limit reached");
  }
  const supabase = getServiceSupabaseClient();
  const { data: linkData, error: linkError } = await supabase
    .from("assignment_students")
    .select("assignment_id, assigned_at, missed_at, cancelled_at")
    .eq("student_id", studentId)
    .is("cancelled_at", null);

  if (linkError) {
    throw new Error("배정된 시험 목록을 불러오지 못했습니다.");
  }
  if (!linkData?.length) {
    return [];
  }

  const assignmentIds = linkData.map((link) => link.assignment_id);
  const missedAtByAssignment = new Map(
    linkData.map((link) => [link.assignment_id, link.missed_at]),
  );
  const assignedAtByAssignment = new Map(
    linkData.map((link) => [link.assignment_id, link.assigned_at]),
  );
  const [
    { data: assignmentData, error: assignmentError },
    { data: attemptData, error: attemptError },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "id, title, assignment_purpose, dataset_id, range_start, range_end, question_count, english_to_korean_ratio, time_limit_seconds, timing_mode, question_time_limit_seconds, passing_score, retake_allowed, range_basis, question_bank_version, question_order_mode, status, available_from, available_until",
      )
      .in("id", assignmentIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("quiz_attempts")
      .select(
        "id, assignment_id, status, phase, attempt_number, started_at, initial_completed_at, retry_started_at, deadline_at, completed_at, unresolved_wrong_count, initial_score, final_score, passed",
      )
      .eq("student_id", studentId)
      .in("assignment_id", assignmentIds)
      .order("attempt_number", { ascending: false }),
  ]);

  if (assignmentError || attemptError) {
    throw new Error("배정된 시험 상태를 불러오지 못했습니다.");
  }
  if (!assignmentData?.length) return [];

  const assignments = (assignmentData ?? []) as AssignmentRow[];
  const attempts = (attemptData ?? []) as AttemptRow[];
  const datasetIds = [...new Set(assignments.map((item) => item.dataset_id))];
  const [
    { data: datasetData, error: datasetError },
    { data: assignmentUnitData, error: assignmentUnitError },
  ] = await Promise.all([
    supabase
      .from("vocab_datasets")
      .select("id, title, edition")
      .in("id", datasetIds),
    supabase
      .from("assignment_units")
      .select(
        "assignment_id, position, is_primary, vocab_units(unit_label)",
      )
      .in("assignment_id", assignmentIds)
      .order("position"),
  ]);
  if (datasetError || assignmentUnitError) {
    throw new Error("시험 범위 정보를 불러오지 못했습니다.");
  }
  const datasetTitles = await loadDatasetDisplayLabelMap(
    supabase,
    (datasetData ?? []).map((dataset) => ({
      id: dataset.id,
      title: dataset.title,
      edition: dataset.edition,
    })),
  );
  const unitLabelsByAssignment = new Map<string, string[]>();
  const primaryUnitLabelsByAssignment = new Map<string, string[]>();
  for (const link of assignmentUnitData ?? []) {
    const relatedUnit = Array.isArray(link.vocab_units)
      ? link.vocab_units[0]
      : link.vocab_units;
    const labels = unitLabelsByAssignment.get(link.assignment_id) ?? [];
    if (relatedUnit?.unit_label) labels.push(relatedUnit.unit_label);
    unitLabelsByAssignment.set(link.assignment_id, labels);
    if (link.is_primary && relatedUnit?.unit_label) {
      const primaryLabels =
        primaryUnitLabelsByAssignment.get(link.assignment_id) ?? [];
      primaryLabels.push(relatedUnit.unit_label);
      primaryUnitLabelsByAssignment.set(
        link.assignment_id,
        primaryLabels,
      );
    }
  }
  const latestAttempts = new Map<string, AttemptRow>();
  for (const attempt of attempts) {
    if (!latestAttempts.has(attempt.assignment_id)) {
      latestAttempts.set(attempt.assignment_id, attempt);
    }
  }

  const summaries = assignments.map((assignment) => {
    const unitLabels =
      unitLabelsByAssignment.get(assignment.id) ?? [];
    const primaryUnitLabels =
      primaryUnitLabelsByAssignment.get(assignment.id) ?? [];
    const fallbackUnitLabels =
      unitLabels.length > 0
        ? unitLabels
        : [`${assignment.range_start}~${assignment.range_end}번`];
    const lastAttempt = latestAttempts.get(assignment.id);
    const missedAt =
      missedAtByAssignment.get(assignment.id) ?? null;
    const assignedAt =
      assignedAtByAssignment.get(assignment.id) ??
      new Date(0).toISOString();
    const datasetTitle = datasetTitles.get(assignment.dataset_id) ?? "어휘";
    const summary: StudentAssignmentSummary = {
      id: assignment.id,
      assignmentStatus: assignment.status,
      title: assignment.title,
      displayTitle: assignmentDisplayTitleForUnits(
        assignment.title,
        [...fallbackUnitLabels, ...primaryUnitLabels],
        datasetTitle,
      ),
      datasetTitle,
      assignmentPurpose: assignment.assignment_purpose,
      scopeLabel: assignmentScopeLabel({
        assignmentPurpose: assignment.assignment_purpose,
        unitLabels: fallbackUnitLabels,
        primaryUnitLabels,
        questionCount: assignment.question_count,
      }),
      questionCount: assignment.question_count,
      questionOrderMode: assignment.question_order_mode,
      timeLimitSeconds: assignment.time_limit_seconds,
      timingMode: assignment.timing_mode,
      questionTimeLimitSeconds:
        assignment.question_time_limit_seconds,
      passingScore: assignment.passing_score,
      retakeAllowed: assignment.retake_allowed,
      lastAttemptId: lastAttempt?.id ?? null,
      lastStatus: lastAttempt?.status ?? null,
      lastPhase: lastAttempt?.phase ?? null,
      lastInitialScore:
        lastAttempt?.initial_score === null ||
        lastAttempt?.initial_score === undefined
          ? null
          : Number(lastAttempt.initial_score),
      lastFinalScore:
        lastAttempt?.final_score === null ||
        lastAttempt?.final_score === undefined
          ? null
          : Number(lastAttempt.final_score),
      lastPassed: lastAttempt?.passed ?? null,
      lastRetryStartedAt: lastAttempt?.retry_started_at ?? null,
      lastStartedAt: lastAttempt?.started_at ?? null,
      lastInitialCompletedAt:
        lastAttempt?.initial_completed_at ?? null,
      lastCompletedAt: lastAttempt?.completed_at ?? null,
      lastDeadlineAt:
        assignment.timing_mode === "none"
          ? null
          : lastAttempt?.deadline_at ?? null,
      lastUnresolvedWrongCount:
        lastAttempt?.unresolved_wrong_count ?? null,
      assignedAt,
      availableFrom: assignment.available_from,
      availableUntil: assignment.available_until,
      missedAt,
    };

    return summary;
  });

  return summaries;
}

