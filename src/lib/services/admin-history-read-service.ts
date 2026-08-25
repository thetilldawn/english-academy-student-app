import "server-only";

import { requireAdmin } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { finalizeStaleQuizAttempts } from "@/lib/services/stale-attempt-service";
import { datasetDisplayLabel } from "@/lib/admin/dataset-display";
import {
  loadDatasetDisplayLabelMap,
} from "@/lib/services/dataset-catalog-service";
import {
  buildAssignmentHistory,
  projectCurrentAssignmentHistory,
  type AssignmentHistorySource,
  type AssignmentHistorySummary,
  type AttemptHistorySource,
} from "@/lib/admin/history";
import { learningActivitySection } from "@/features/history/domain/learning-activity";
import {
  historyEntryKey,
  parseHistoryEntryKey,
} from "@/lib/admin/history-route";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import type { AdminHistoryDetail } from "@/features/history/model";

import { getAdminAttemptDetail } from "./admin-attempt-read-service";
import { getAdminAttemptPointSummary } from "./learning-point-read-service";

function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
type HistoryStudentRelation = {
  display_name: string;
  status: "active" | "blocked";
  school_name: string | null;
  grade_label: string | null;
  deleted_at: string | null;
};

type HistoryDatasetRelation = {
  title: string;
  edition: string | null;
};

type HistoryUnitRelation = {
  id: string;
  unit_label: string;
  sort_index: number;
};

type HistoryAssignmentUnitRelation = {
  position: number;
  is_primary: boolean;
  unit: HistoryUnitRelation | HistoryUnitRelation[] | null;
};

type HistoryAssignmentRelation = {
  id: string;
  title: string;
  deleted_at: string | null;
  status: "draft" | "active" | "closed";
  assignment_purpose: "regular" | "review" | "mixed";
  dataset_id: string;
  range_start: number;
  range_end: number;
  range_basis: "source_rows" | "units";
  question_count: number;
  english_to_korean_ratio: number;
  time_limit_seconds: number;
  timing_mode: TimingMode;
  question_time_limit_seconds: number | null;
  passing_score: number;
  question_order_mode: QuestionOrderMode;
  available_from: string | null;
  available_until: string | null;
  dataset: HistoryDatasetRelation | HistoryDatasetRelation[] | null;
  assignment_units: HistoryAssignmentUnitRelation[] | null;
};

type HistoryAssignmentStudentRow = {
  assignment_id: string;
  student_id: string;
  assigned_at: string;
  missed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  student: HistoryStudentRelation | HistoryStudentRelation[] | null;
  assignment:
    | HistoryAssignmentRelation
    | HistoryAssignmentRelation[]
    | null;
};

type HistoryAttemptRow = {
  id: string;
  assignment_id: string;
  student_id: string;
  attempt_number: number;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  question_count_snapshot: number;
  time_limit_seconds_snapshot: number;
  passing_score_snapshot: number;
  initial_correct_count: number | null;
  retry_correct_count: number | null;
  unresolved_wrong_count: number | null;
  initial_score: number | string | null;
  final_score: number | string | null;
  passed: boolean | null;
  started_at: string;
  initial_completed_at: string | null;
  retry_started_at: string | null;
  deadline_at: string;
  completed_at: string | null;
};

type HiddenHistoryEntryRow = {
  assignment_id: string;
  student_id: string;
  attempt_id: string | null;
};

const HISTORY_PAGE_SIZE = 1000;

async function listAssignmentHistorySourceRows(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  const rows: HistoryAssignmentStudentRow[] = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("assignment_students")
      .select(
        `
          assignment_id,
          student_id,
          assigned_at,
          missed_at,
          cancelled_at,
          cancellation_reason,
          student:students(display_name, status, school_name, grade_label, deleted_at),
          assignment:assignments(
            id,
            title,
            deleted_at,
            status,
            assignment_purpose,
            dataset_id,
            range_start,
            range_end,
            range_basis,
            question_count,
            english_to_korean_ratio,
            time_limit_seconds,
            timing_mode,
            question_time_limit_seconds,
            passing_score,
            question_order_mode,
            available_from,
            available_until,
            dataset:vocab_datasets(title, edition),
            assignment_units(
              position,
              is_primary,
              unit:vocab_units(id, unit_label, sort_index)
            )
          )
        `,
      )
      .order("assigned_at", { ascending: false })
      .order("assignment_id")
      .order("student_id")
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }
    const page = (data ?? []) as HistoryAssignmentStudentRow[];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

async function listAttemptHistoryRows(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  const rows: HistoryAttemptRow[] = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select(
        "id, assignment_id, student_id, attempt_number, status, phase, question_count_snapshot, time_limit_seconds_snapshot, passing_score_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, started_at, initial_completed_at, retry_started_at, deadline_at, completed_at",
      )
      .order("started_at", { ascending: false })
      .order("id")
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }
    const page = (data ?? []) as HistoryAttemptRow[];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

async function listHiddenHistoryEntries(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  const rows: HiddenHistoryEntryRow[] = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("admin_history_hidden_entries")
      .select("assignment_id, student_id, attempt_id")
      .order("hidden_at", { ascending: false })
      .order("id")
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }
    const page = (data ?? []) as HiddenHistoryEntryRow[];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

export async function listAssignmentHistoryBundle(options?: {
  finalizeStale?: boolean;
}): Promise<{
  history: AssignmentHistorySummary[];
  completeHistory: AssignmentHistorySummary[];
  currentHistory: AssignmentHistorySummary[];
}> {
  await requireAdmin();
  if (options?.finalizeStale !== false) {
    await finalizeStaleQuizAttempts();
  }
  const supabase = await createServerSupabaseClient();
  const [
    { data: assignmentStudentData, error: assignmentStudentError },
    { data: attemptData, error: attemptError },
    { data: hiddenHistoryData, error: hiddenHistoryError },
  ] = await Promise.all([
    listAssignmentHistorySourceRows(supabase),
    listAttemptHistoryRows(supabase),
    listHiddenHistoryEntries(supabase),
  ]);

  if (
    assignmentStudentError ||
    attemptError ||
    hiddenHistoryError
  ) {
    throw new Error("시험 배정과 응시 내역을 불러오지 못했습니다.");
  }
  const historyDatasets = (
    (assignmentStudentData ?? []) as HistoryAssignmentStudentRow[]
  ).flatMap((row) => {
    const assignment = oneRelation(row.assignment);
    const dataset = assignment ? oneRelation(assignment.dataset) : null;
    return assignment && dataset
      ? [{ id: assignment.dataset_id, ...dataset }]
      : [];
  });
  const datasetLabelById = await loadDatasetDisplayLabelMap(
    supabase,
    historyDatasets,
  );
  const assignmentSources = (
    (assignmentStudentData ?? []) as HistoryAssignmentStudentRow[]
  ).flatMap((row): AssignmentHistorySource[] => {
    const student = oneRelation(row.student);
    const assignment = oneRelation(row.assignment);
    if (!student || !assignment) return [];

    const dataset = oneRelation(assignment.dataset);
    const orderedUnitLinks = (assignment.assignment_units ?? [])
      .toSorted((left, right) => left.position - right.position)
      .flatMap((link) => {
        const unit = oneRelation(link.unit);
        return unit
          ? [{ unit, isPrimary: link.is_primary }]
          : [];
      });
    const orderedUnits = orderedUnitLinks.map((link) => link.unit);
    const primaryUnits = orderedUnitLinks
      .filter((link) => link.isPrimary)
      .map((link) => link.unit);
    const legacyUnitLabels =
      assignment.range_basis === "source_rows"
        ? [
            `원본 행 ${assignment.range_start.toLocaleString()}~${assignment.range_end.toLocaleString()}`,
          ]
        : [];

    return [
      {
        assignmentId: row.assignment_id,
        assignmentTitle:
          assignment.deleted_at === null ? assignment.title : "삭제됨",
        assignmentDeleted: assignment.deleted_at !== null,
        assignmentStatus: assignment.status,
        assignmentPurpose: assignment.assignment_purpose,
        studentId: row.student_id,
        studentName:
          student.deleted_at === null ? student.display_name : "삭제됨",
        studentDeleted: student.deleted_at !== null,
        studentStatus: student.status,
        schoolName:
          student.deleted_at === null ? student.school_name : null,
        gradeLabel:
          student.deleted_at === null ? student.grade_label : null,
        datasetId: assignment.dataset_id,
        datasetTitle:
          datasetLabelById.get(assignment.dataset_id) ??
          (dataset
            ? datasetDisplayLabel(dataset.title, dataset.edition)
            : "단어장"),
        unitIds: orderedUnits.map((unit) => unit.id),
        unitLabels:
          orderedUnits.length > 0
            ? orderedUnits.map((unit) => unit.unit_label)
            : legacyUnitLabels,
        unitSortIndexes:
          orderedUnits.length > 0
            ? orderedUnits.map((unit) => unit.sort_index)
            : undefined,
        primaryUnitIds: primaryUnits.map((unit) => unit.id),
        primaryUnitLabels:
          primaryUnits.length > 0
            ? primaryUnits.map((unit) => unit.unit_label)
            : assignment.assignment_purpose === "regular"
              ? legacyUnitLabels
              : [],
        primaryUnitSortIndexes:
          primaryUnits.length > 0
            ? primaryUnits.map((unit) => unit.sort_index)
            : undefined,
        questionCount: assignment.question_count,
        englishToKoreanRatio: assignment.english_to_korean_ratio,
        timeLimitSeconds: assignment.time_limit_seconds,
        timingMode: assignment.timing_mode,
        questionTimeLimitSeconds: assignment.question_time_limit_seconds,
        passingScore: assignment.passing_score,
        questionOrderMode: assignment.question_order_mode,
        availableFrom: assignment.available_from,
        availableUntil: assignment.available_until,
        assignedAt: row.assigned_at,
        missedAt: row.missed_at,
        cancelledAt: row.cancelled_at,
        cancellationReason: row.cancellation_reason,
      },
    ];
  });

  const attemptSources = (
    (attemptData ?? []) as HistoryAttemptRow[]
  ).map(
    (attempt): AttemptHistorySource => ({
      id: attempt.id,
      assignmentId: attempt.assignment_id,
      studentId: attempt.student_id,
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      phase: attempt.phase,
      questionCount: attempt.question_count_snapshot,
      timeLimitSeconds: attempt.time_limit_seconds_snapshot,
      passingScore: attempt.passing_score_snapshot,
      initialCorrectCount: attempt.initial_correct_count,
      retryCorrectCount: attempt.retry_correct_count,
      unresolvedWrongCount: attempt.unresolved_wrong_count,
      initialScore:
        attempt.initial_score === null
          ? null
          : Number(attempt.initial_score),
      finalScore:
        attempt.final_score === null ? null : Number(attempt.final_score),
      passed: attempt.passed,
      startedAt: attempt.started_at,
      initialCompletedAt: attempt.initial_completed_at,
      retryStartedAt: attempt.retry_started_at,
      deadlineAt: attempt.deadline_at,
      completedAt: attempt.completed_at,
    }),
  );

  const hiddenAttempts = new Set<string>();
  const hiddenRecipients = new Set<string>();
  for (const hidden of (
    (hiddenHistoryData ?? []) as HiddenHistoryEntryRow[]
  )) {
    if (hidden.attempt_id) {
      hiddenAttempts.add(hidden.attempt_id);
    } else {
      hiddenRecipients.add(
        `${hidden.assignment_id}\u0000${hidden.student_id}`,
      );
    }
  }

  const completeHistory = buildAssignmentHistory(
    assignmentSources,
    attemptSources,
  );
  const completeCurrentHistory = projectCurrentAssignmentHistory(
    completeHistory,
  );
  const isVisibleHistoryItem = (item: AssignmentHistorySummary) =>
    item.attemptId
      ? !hiddenAttempts.has(item.attemptId)
      : !hiddenRecipients.has(
          `${item.assignmentId}\u0000${item.studentId}`,
        );

  return {
    completeHistory,
    currentHistory: completeCurrentHistory.filter(
      (item) =>
        isVisibleHistoryItem(item) &&
        learningActivitySection(item) !== "archived",
    ),
    history: completeHistory.filter(isVisibleHistoryItem),
  };
}

export async function listAssignmentHistory(): Promise<
  AssignmentHistorySummary[]
> {
  return (await listAssignmentHistoryBundle()).history;
}

export async function listCurrentAssignmentHistory(): Promise<
  AssignmentHistorySummary[]
> {
  return (await listAssignmentHistoryBundle()).currentHistory;
}

export async function getAdminHistoryDetail(
  entryKey: string,
): Promise<AdminHistoryDetail | null> {
  const parsed = parseHistoryEntryKey(entryKey);
  if (!parsed) return null;

  const { history } = await listAssignmentHistoryBundle();
  const summary =
    parsed.kind === "attempt"
      ? history.find((item) => item.attemptId === parsed.attemptId)
      : history.find(
          (item) =>
            item.assignmentId === parsed.assignmentId &&
            item.studentId === parsed.studentId,
        );
  if (!summary) return null;

  const [attempt, pointSummary] = summary.attemptId
    ? await Promise.all([
        getAdminAttemptDetail(summary.attemptId),
        getAdminAttemptPointSummary(summary.studentId, summary.attemptId),
      ])
    : [null, null];

  return {
    summary,
    attempt,
    canonicalKey: historyEntryKey(summary),
    pointSummary,
  };
}
