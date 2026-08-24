import "server-only";

import type { AssignmentEditDraft } from "@/lib/admin/assignment-edit";
import type { TimingMode } from "@/lib/admin/assignment-settings";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  AssignmentReplacementError,
} from "@/lib/services/assignment-replacement-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type StudentRelation = {
  id: string;
  display_name: string;
  status: "active" | "blocked";
  deleted_at: string | null;
};

type UnitRelation = {
  id: string;
  unit_label: string;
};

type AssignmentUnitRelation = {
  position: number;
  is_primary: boolean;
  unit: UnitRelation | UnitRelation[] | null;
};

type AssignmentRelation = {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  deleted_at: string | null;
  assignment_purpose: "regular" | "mixed" | "review";
  dataset_id: string;
  question_count: number;
  english_to_korean_ratio: number;
  time_limit_seconds: number;
  timing_mode: TimingMode;
  question_time_limit_seconds: number | null;
  passing_score: number;
  retry_enabled: boolean;
  retry_passing_score: number | null;
  question_order_mode: "fixed" | "ascending" | "descending" | "random";
  available_until: string | null;
  assignment_units: AssignmentUnitRelation[] | null;
};

type AssignmentStudentRelation = {
  assignment_id: string;
  student_id: string;
  missed_at: string | null;
  cancelled_at: string | null;
  student: StudentRelation | StudentRelation[] | null;
  assignment: AssignmentRelation | AssignmentRelation[] | null;
};

type SourceAttemptRow = {
  status: "in_progress" | "completed" | "expired";
};

type SourceQuestionRow = {
  id: string;
  vocab_entry_id: number;
  base_order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  choice_vocab_entry_ids: number[] | null;
};

type SourceReviewTargetRow = {
  review_queue_id: string;
  assignment_question_id: string;
  vocab_entry_id: number;
};

type SourceReviewQueueRow = {
  id: string;
  reason_level: 1 | 2;
};

export type AssignmentQuestionPlan = {
  vocab_entry_id: number;
  base_order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  choice_vocab_entry_ids: number[];
};

export type EditableSourceContext = {
  draft: AssignmentEditDraft;
  questions: AssignmentQuestionPlan[] | null;
  selectedQueueIds: string[];
  selectedReviewLevels: (1 | 2)[];
  selectedReviewVocabEntryIds: number[];
};

function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function loadSourceSnapshot(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  assignmentId: string,
  studentId: string,
  purpose: AssignmentRelation["assignment_purpose"],
) {
  const [questionResult, targetResult] = await Promise.all([
    supabase
      .from("assignment_questions")
      .select(
        "id, vocab_entry_id, base_order_index, direction, choice_vocab_entry_ids",
      )
      .eq("assignment_id", assignmentId)
      .order("base_order_index"),
    purpose === "regular"
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("assignment_review_targets")
          .select(
            "review_queue_id, assignment_question_id, vocab_entry_id",
          )
          .eq("assignment_id", assignmentId)
          .eq("student_id", studentId)
          .is("released_at", null),
  ]);
  if (questionResult.error || targetResult.error) {
    throw new AssignmentReplacementError("database");
  }

  const sourceQuestions = (questionResult.data ?? []) as SourceQuestionRow[];
  const questions = sourceQuestions.every(
    (question) =>
      Array.isArray(question.choice_vocab_entry_ids) &&
      question.choice_vocab_entry_ids.length === 4,
  )
    ? sourceQuestions.map((question) => ({
        vocab_entry_id: question.vocab_entry_id,
        base_order_index: question.base_order_index,
        direction: question.direction,
        choice_vocab_entry_ids: question.choice_vocab_entry_ids!,
      }))
    : null;

  if (purpose === "regular") {
    return {
      questions,
      selectedQueueIds: [] as string[],
      selectedReviewLevels: [] as (1 | 2)[],
      selectedReviewVocabEntryIds: [] as number[],
      reviewLevels: [] as (1 | 2)[],
    };
  }

  const orderByQuestionId = new Map(
    sourceQuestions.map((question) => [
      question.id,
      question.base_order_index,
    ]),
  );
  const targets = ((targetResult.data ?? []) as SourceReviewTargetRow[])
    .toSorted(
      (left, right) =>
        (orderByQuestionId.get(left.assignment_question_id) ?? 0) -
        (orderByQuestionId.get(right.assignment_question_id) ?? 0),
    );
  if (targets.length === 0 && purpose === "review") {
    throw new AssignmentReplacementError(
      "conflict",
      "기존 오답 연결을 확인하지 못해 이 배정은 수정할 수 없습니다.",
    );
  }

  const selectedQueueIds = targets.map((target) => target.review_queue_id);
  const queueRows =
    selectedQueueIds.length === 0
      ? []
      : await (async () => {
          const { data: queueData, error: queueError } = await supabase
            .from("student_vocab_review_queue")
            .select("id, reason_level")
            .in("id", selectedQueueIds);
          if (queueError) {
            throw new AssignmentReplacementError("database");
          }
          return (queueData ?? []) as SourceReviewQueueRow[];
        })();
  const levelByQueueId = new Map(
    queueRows.map((queue) => [queue.id, queue.reason_level]),
  );
  if (
    queueRows.length !== selectedQueueIds.length ||
    selectedQueueIds.some((queueId) => !levelByQueueId.has(queueId))
  ) {
    throw new AssignmentReplacementError(
      "database",
      "기존 오답 단계를 확인하지 못해 이 배정은 수정할 수 없습니다.",
    );
  }

  return {
    questions,
    selectedQueueIds,
    selectedReviewLevels: selectedQueueIds.map(
      (queueId) => levelByQueueId.get(queueId)!,
    ),
    selectedReviewVocabEntryIds: targets.map(
      (target) => target.vocab_entry_id,
    ),
    reviewLevels: [
      ...new Set(
        selectedQueueIds.map((queueId) => levelByQueueId.get(queueId)!),
      ),
    ].toSorted() as (1 | 2)[],
  };
}

export async function requireEditableSourceContext(
  assignmentId: string,
  studentId: string,
  authenticatedAdmin?: AdminContext,
): Promise<EditableSourceContext> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const [{ data, error }, { data: attemptData, error: attemptError }] =
    await Promise.all([
      supabase
        .from("assignment_students")
        .select(
          `
            assignment_id,
            student_id,
            missed_at,
            cancelled_at,
            student:students(id, display_name, status, deleted_at),
            assignment:assignments(
              id,
              title,
              status,
              deleted_at,
              assignment_purpose,
              dataset_id,
              question_count,
              english_to_korean_ratio,
              time_limit_seconds,
              timing_mode,
              question_time_limit_seconds,
              passing_score,
              retry_enabled,
              retry_passing_score,
              question_order_mode,
              available_until,
              assignment_units(
                position,
                is_primary,
                unit:vocab_units(id, unit_label)
              )
            )
          `,
        )
        .eq("assignment_id", assignmentId)
        .eq("student_id", studentId)
        .maybeSingle(),
      supabase
        .from("quiz_attempts")
        .select("status")
        .eq("assignment_id", assignmentId)
        .eq("student_id", studentId),
    ]);

  if (error || attemptError) {
    throw new AssignmentReplacementError("database");
  }
  if (!data) {
    throw new AssignmentReplacementError("not_found");
  }
  const row = data as AssignmentStudentRelation;
  const student = oneRelation(row.student);
  const assignment = oneRelation(row.assignment);
  if (!student || !assignment) {
    throw new AssignmentReplacementError("not_found");
  }
  if (student.deleted_at || assignment.deleted_at) {
    throw new AssignmentReplacementError("deleted");
  }
  if (student.status !== "active") {
    throw new AssignmentReplacementError("blocked");
  }
  if (row.cancelled_at) {
    throw new AssignmentReplacementError("cancelled");
  }
  if (row.missed_at) {
    throw new AssignmentReplacementError("missed");
  }
  const attempts = (attemptData ?? []) as SourceAttemptRow[];
  if (
    attempts.some(
      (attempt) =>
        attempt.status === "completed" || attempt.status === "expired",
    )
  ) {
    throw new AssignmentReplacementError("completed");
  }
  if (attempts.length > 0) {
    throw new AssignmentReplacementError("started");
  }
  if (
    assignment.available_until &&
    Date.parse(assignment.available_until) <= Date.now()
  ) {
    throw new AssignmentReplacementError("deadline_elapsed");
  }
  if (assignment.status !== "active") {
    throw new AssignmentReplacementError("closed");
  }

  const orderedUnitLinks = (assignment.assignment_units ?? [])
    .toSorted((left, right) => left.position - right.position)
    .flatMap((link) => {
      const unit = oneRelation(link.unit);
      return unit ? [{ ...link, unit }] : [];
    });
  const primaryUnitIds = orderedUnitLinks
    .filter(
      (link) =>
        link.is_primary || assignment.assignment_purpose === "review",
    )
    .map((link) => link.unit.id);
  if (primaryUnitIds.length === 0) {
    throw new AssignmentReplacementError("invalid_selection");
  }

  const sourceSnapshot = await loadSourceSnapshot(
    supabase,
    assignmentId,
    studentId,
    assignment.assignment_purpose,
  );
  if (
    sourceSnapshot.questions &&
    sourceSnapshot.questions.length !== assignment.question_count
  ) {
    throw new AssignmentReplacementError("database");
  }
  if (
    assignment.assignment_purpose === "review" &&
    sourceSnapshot.selectedQueueIds.length !== assignment.question_count
  ) {
    throw new AssignmentReplacementError(
      "conflict",
      "오답 시험 대상 일부가 이미 해결되어 기존 배정을 수정할 수 없습니다. 남은 오답으로 새 시험을 배정해 주세요.",
    );
  }

  const ratio = assignment.english_to_korean_ratio;
  if (ratio !== 0 && ratio !== 50 && ratio !== 100) {
    throw new AssignmentReplacementError("invalid_selection");
  }

  return {
    draft: {
      assignmentId,
      studentId,
      studentName: student.display_name,
      purpose: assignment.assignment_purpose,
      title: assignment.title,
      datasetId: assignment.dataset_id,
      primaryUnitIds,
      questionCount: assignment.question_count,
      englishToKoreanRatio: ratio,
      timeLimitSeconds: assignment.time_limit_seconds,
      timingMode: assignment.timing_mode,
      questionTimeLimitSeconds:
        assignment.question_time_limit_seconds,
      passingScore: assignment.passing_score,
      retryEnabled: assignment.retry_enabled,
      retryPassingScore: assignment.retry_passing_score,
      questionOrderMode: assignment.question_order_mode,
      availableUntil: assignment.available_until,
      includePendingReview:
        sourceSnapshot.selectedQueueIds.length > 0,
      reviewLevels: sourceSnapshot.reviewLevels,
    },
    questions: sourceSnapshot.questions,
    selectedQueueIds: sourceSnapshot.selectedQueueIds,
    selectedReviewLevels: sourceSnapshot.selectedReviewLevels,
    selectedReviewVocabEntryIds:
      sourceSnapshot.selectedReviewVocabEntryIds,
  };
}

export async function getStudentAssignmentEditDraft(
  assignmentId: string,
  studentId: string,
  authenticatedAdmin?: AdminContext,
) {
  return (
    await requireEditableSourceContext(
      assignmentId,
      studentId,
      authenticatedAdmin,
    )
  ).draft;
}
