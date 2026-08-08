import "server-only";

import {
  createQuizQuestions,
  type QuizVocabularyEntry,
} from "@/lib/quiz/engine";
import {
  assignmentDisplayTitleForUnits,
  assignmentScopeLabel,
  type AssignmentPurpose,
} from "@/lib/admin/history";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import { deriveAttemptQuestionMetrics } from "@/lib/quiz/result-presentation";
import {
  parseChoicePronunciations,
  parseTargetPronunciation,
  unavailablePronunciation,
  type QuizPronunciation,
} from "@/lib/quiz/pronunciation-snapshot";
import {
  isTrustedQuestionSnapshot,
  type QuestionProvenanceStatus,
} from "@/lib/quiz/question-provenance";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import {
  compareLearningActivities,
  learningActivitySection,
  type LearningActivityOrderInput,
  type LearningActivitySection,
} from "@/lib/admin/learning-activity";
import { loadDatasetDisplayLabelMap } from "@/lib/services/dataset-catalog-service";
import { finalizeStudentMissedAssignments } from "@/lib/services/missed-assignment-service";
import { finalizeStaleQuizAttempts } from "@/lib/services/stale-attempt-service";

export type StudentAssignmentSummary = {
  id: string;
  title: string;
  displayTitle: string;
  datasetTitle: string;
  assignmentPurpose: AssignmentPurpose;
  scopeLabel: string;
  questionCount: number;
  questionOrderMode: QuestionOrderMode;
  timeLimitSeconds: number;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  passingScore: number;
  retakeAllowed: boolean;
  lastAttemptId: string | null;
  lastStatus: "in_progress" | "completed" | "expired" | null;
  lastPhase: AttemptState["phase"] | null;
  lastInitialScore: number | null;
  lastFinalScore: number | null;
  lastPassed: boolean | null;
  lastRetryStartedAt: string | null;
  lastStartedAt: string | null;
  lastInitialCompletedAt: string | null;
  lastCompletedAt: string | null;
  lastDeadlineAt: string | null;
  lastUnresolvedWrongCount: number | null;
  assignedAt: string;
  availableUntil: string | null;
  missedAt: string | null;
  missed: boolean;
  canStart: boolean;
  activitySection: Exclude<LearningActivitySection, "archived">;
};

export type AttemptQuestionState = {
  id: string;
  orderIndex: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: string[];
  pronunciation: QuizPronunciation;
  choicePronunciations: QuizPronunciation[];
  initialChoiceIndex: number | null;
  initialIsCorrect: boolean | null;
  retryChoiceIndex: number | null;
  retryIsCorrect: boolean | null;
  priorWrongLevel: 0 | 1 | 2;
  initialTimedOut: boolean;
  retryTimedOut: boolean;
  revealedCorrectChoiceIndex: number | null;
};

export type AttemptState = {
  id: string;
  assignmentTitle: string;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  startedAt: string;
  deadlineAt: string;
  timerDeadlineAt: string;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  questions: AttemptQuestionState[];
  currentQuestionId: string | null;
};

export type AttemptQuestionResult = {
  id: string;
  orderIndex: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  correctAnswer: string;
  correctChoiceIndex: number;
  initialChoice: string | null;
  initialIsCorrect: boolean | null;
  retryChoice: string | null;
  retryIsCorrect: boolean | null;
  wrongCount: number;
  headword: string;
  primaryMeaning: string;
  provenanceStatus: QuestionProvenanceStatus;
};

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

type QuestionRow = {
  id: string;
  order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: string[];
  correct_choice_index: number;
  initial_choice_index: number | null;
  initial_is_correct: boolean | null;
  retry_choice_index: number | null;
  retry_is_correct: boolean | null;
  initial_timed_out?: boolean;
  retry_timed_out?: boolean;
  prior_wrong_count: number;
  assignment_question:
    | AssignmentQuestionSnapshot
    | AssignmentQuestionSnapshot[]
    | null;
};

type AssignmentQuestionSnapshot = {
  headword_snapshot: string | null;
  primary_meaning_snapshot: string | null;
  provenance_status: QuestionProvenanceStatus;
  exam_use_snapshot?:
    | ExamUseQuestionSnapshot
    | ExamUseQuestionSnapshot[]
    | null;
};

type ExamUseQuestionSnapshot = {
  headword_snapshot: string;
  primary_meaning_snapshot: string;
  display_pronunciation_ko_snapshot: string | null;
  pronunciation_snapshot: unknown;
  choice_dictionary_snapshots: unknown;
  provenance_status: "reviewed_for_preview_v1";
};

type ResultQuestionRow = {
  id: string;
  order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: unknown;
  correct_choice_index: number;
  initial_choice_index: number | null;
  initial_is_correct: boolean | null;
  retry_choice_index: number | null;
  retry_is_correct: boolean | null;
  prior_wrong_count: number;
  initial_timed_out?: boolean;
  retry_timed_out?: boolean;
  assignment_question:
    | AssignmentQuestionSnapshot
    | AssignmentQuestionSnapshot[]
    | null;
  vocab_entries:
    | { headword: string; primary_meaning: string }
    | Array<{ headword: string; primary_meaning: string }>
    | null;
};

function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function reviewedExamUseSnapshot(
  question: AssignmentQuestionSnapshot | null,
): ExamUseQuestionSnapshot | null {
  const snapshot = oneRelation(question?.exam_use_snapshot ?? null);
  return snapshot?.provenance_status === "reviewed_for_preview_v1"
    ? snapshot
    : null;
}

export function mapResultQuestions(
  rows: ResultQuestionRow[],
): AttemptQuestionResult[] {
  return rows.map((row) => {
    const choices = Array.isArray(row.choices)
      ? row.choices.filter(
          (choice): choice is string => typeof choice === "string",
        )
      : [];
    const vocabulary = Array.isArray(row.vocab_entries)
      ? row.vocab_entries[0]
      : row.vocab_entries;
    const bankQuestion = oneRelation(row.assignment_question);
    const examUseSnapshot = reviewedExamUseSnapshot(bankQuestion);
    const verifiedSnapshot = isTrustedQuestionSnapshot(
      bankQuestion?.provenance_status,
    )
      ? bankQuestion
      : null;

    return {
      id: row.id,
      orderIndex: row.order_index,
      direction: row.direction,
      prompt: row.prompt,
      correctAnswer: choices[row.correct_choice_index] ?? "",
      correctChoiceIndex: row.correct_choice_index,
      initialChoice:
        Boolean(row.initial_timed_out) ||
        row.initial_choice_index === null
          ? null
          : (choices[row.initial_choice_index] ?? null),
      initialIsCorrect: row.initial_is_correct,
      retryChoice:
        Boolean(row.retry_timed_out) ||
        row.retry_choice_index === null
          ? null
          : (choices[row.retry_choice_index] ?? null),
      retryIsCorrect: row.retry_is_correct,
      wrongCount:
        Math.max(0, row.prior_wrong_count) +
        (row.initial_is_correct === false ? 1 : 0),
      headword:
        examUseSnapshot?.headword_snapshot ??
        verifiedSnapshot?.headword_snapshot ??
        vocabulary?.headword ??
        "",
      primaryMeaning:
        examUseSnapshot?.primary_meaning_snapshot ??
        verifiedSnapshot?.primary_meaning_snapshot ??
        vocabulary?.primary_meaning ??
        "",
      provenanceStatus:
        examUseSnapshot?.provenance_status ??
        verifiedSnapshot?.provenance_status ?? "legacy_backfill",
    };
  });
}

export async function getAttemptQuestionResults(
  attemptId: string,
): Promise<AttemptQuestionResult[]> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_questions")
    .select(
      "id, order_index, direction, prompt, choices, correct_choice_index, initial_choice_index, initial_is_correct, retry_choice_index, retry_is_correct, prior_wrong_count, initial_timed_out, retry_timed_out, assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey(headword_snapshot, primary_meaning_snapshot, provenance_status, exam_use_snapshot:assignment_question_exam_use_snapshot!assignment_question_exam_use_snapshot_question_fkey(headword_snapshot, primary_meaning_snapshot, display_pronunciation_ko_snapshot, pronunciation_snapshot, choice_dictionary_snapshots, provenance_status)), vocab_entries(headword, primary_meaning)",
    )
    .eq("attempt_id", attemptId)
    .order("order_index");

  if (error) {
    throw new Error("문항 결과를 불러오지 못했습니다.");
  }

  return mapResultQuestions((data ?? []) as ResultQuestionRow[]);
}

export async function listStudentAssignments(
  studentId: string,
): Promise<StudentAssignmentSummary[]> {
  const [, missedFinalization] = await Promise.all([
    finalizeStaleQuizAttempts(),
    finalizeStudentMissedAssignments(studentId),
  ]);
  if (missedFinalization.batchLimitReached) {
    console.warn("[missed-assignment] student batch limit reached");
  }
  const supabase = getServiceSupabaseClient();
  const { data: linkData, error: linkError } = await supabase
    .from("assignment_students")
    .select("assignment_id, assigned_at, missed_at, cancelled_at")
    .eq("student_id", studentId)
    .is("cancelled_at", null);

  if (linkError || !linkData?.length) {
    return [];
  }

  const assignmentIds = linkData.map((link) => link.assignment_id);
  const missedAtByAssignment = new Map(
    linkData.map((link) => [link.assignment_id, link.missed_at]),
  );
  const assignedAtByAssignment = new Map(
    linkData.map((link) => [link.assignment_id, link.assigned_at]),
  );
  const [{ data: assignmentData }, { data: attemptData }] = await Promise.all([
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

  const assignments = (assignmentData ?? []) as AssignmentRow[];
  const attempts = (attemptData ?? []) as AttemptRow[];
  const datasetIds = [...new Set(assignments.map((item) => item.dataset_id))];
  const [
    { data: datasetData },
    { data: assignmentUnitData },
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

  const now = Date.now();
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
    const availableUntilTime = assignment.available_until
      ? Date.parse(assignment.available_until)
      : Number.NaN;
    const missedAt =
      missedAtByAssignment.get(assignment.id) ?? null;
    const missed =
      !lastAttempt &&
      (missedAt !== null ||
        (!Number.isNaN(availableUntilTime) &&
          availableUntilTime <= now));
    const available =
      assignment.status === "active" &&
      (!assignment.available_from ||
        new Date(assignment.available_from).getTime() <= now) &&
      (!assignment.available_until ||
        new Date(assignment.available_until).getTime() > now);
    const canStart =
      !missed &&
      available &&
      (!lastAttempt ||
        lastAttempt.status === "expired" ||
        assignment.retake_allowed);
    const assignedAt =
      assignedAtByAssignment.get(assignment.id) ??
      assignment.available_from ??
      new Date(0).toISOString();
    const orderInput: LearningActivityOrderInput = {
      status: missed
        ? ("missed" as const)
        : (lastAttempt?.status ?? "not_started"),
      phase: lastAttempt?.phase ?? null,
      assignedAt,
      availableUntil: assignment.available_until,
      startedAt: lastAttempt?.started_at ?? null,
      initialCompletedAt:
        lastAttempt?.initial_completed_at ?? null,
      completedAt: lastAttempt?.completed_at ?? null,
      missedAt,
      deadlineAt: lastAttempt?.deadline_at ?? null,
      activityAt:
        lastAttempt?.completed_at ??
        lastAttempt?.started_at ??
        missedAt ??
        assignedAt,
      passed: lastAttempt?.passed ?? null,
      finalScore:
        lastAttempt?.final_score === null ||
        lastAttempt?.final_score === undefined
          ? null
          : Number(lastAttempt.final_score),
      passingScore: assignment.passing_score,
      unresolvedWrongCount:
        lastAttempt?.unresolved_wrong_count ?? null,
    };

    return {
      id: assignment.id,
      title: assignment.title,
      displayTitle: assignmentDisplayTitleForUnits(
        assignment.title,
        [...fallbackUnitLabels, ...primaryUnitLabels],
      ),
      datasetTitle: datasetTitles.get(assignment.dataset_id) ?? "어휘",
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
      lastDeadlineAt: lastAttempt?.deadline_at ?? null,
      lastUnresolvedWrongCount:
        lastAttempt?.unresolved_wrong_count ?? null,
      assignedAt,
      availableUntil: assignment.available_until,
      missedAt,
      missed,
      canStart,
      activitySection: learningActivitySection(orderInput) as Exclude<
        LearningActivitySection,
        "archived"
      >,
    };
  });

  return summaries.toSorted((left, right) =>
    compareLearningActivities(
      {
        status: left.missed ? "missed" : (left.lastStatus ?? "not_started"),
        phase: left.lastPhase,
        assignedAt: left.assignedAt,
        availableUntil: left.availableUntil,
        startedAt: left.lastStartedAt,
        initialCompletedAt: left.lastInitialCompletedAt,
        completedAt: left.lastCompletedAt,
        missedAt: left.missedAt,
        deadlineAt: left.lastDeadlineAt,
        activityAt:
          left.lastCompletedAt ?? left.lastStartedAt ?? left.assignedAt,
        passed: left.lastPassed,
        finalScore: left.lastFinalScore,
        passingScore: left.passingScore,
        unresolvedWrongCount: left.lastUnresolvedWrongCount,
      },
      {
        status: right.missed
          ? "missed"
          : (right.lastStatus ?? "not_started"),
        phase: right.lastPhase,
        assignedAt: right.assignedAt,
        availableUntil: right.availableUntil,
        startedAt: right.lastStartedAt,
        initialCompletedAt: right.lastInitialCompletedAt,
        completedAt: right.lastCompletedAt,
        missedAt: right.missedAt,
        deadlineAt: right.lastDeadlineAt,
        activityAt:
          right.lastCompletedAt ?? right.lastStartedAt ?? right.assignedAt,
        passed: right.lastPassed,
        finalScore: right.lastFinalScore,
        passingScore: right.passingScore,
        unresolvedWrongCount: right.lastUnresolvedWrongCount,
      },
    ),
  );
}

export async function startStudentAttempt(
  studentId: string,
  assignmentId: string,
): Promise<string> {
  await finalizeStaleQuizAttempts();
  const supabase = getServiceSupabaseClient();
  const [{ data: assignmentData, error: assignmentError }, { data: linkData }] =
    await Promise.all([
      supabase
        .from("assignments")
        .select(
          "id, title, assignment_purpose, dataset_id, range_start, range_end, question_count, english_to_korean_ratio, time_limit_seconds, timing_mode, question_time_limit_seconds, passing_score, retake_allowed, range_basis, question_bank_version, question_order_mode, status, available_from, available_until",
        )
        .eq("id", assignmentId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("assignment_students")
        .select("assignment_id, missed_at, cancelled_at")
        .eq("assignment_id", assignmentId)
        .eq("student_id", studentId)
        .maybeSingle(),
    ]);
  const assignment = assignmentData as AssignmentRow | null;

  if (
    assignmentError ||
    !assignment ||
    !linkData ||
    linkData.missed_at !== null ||
    linkData.cancelled_at !== null
  ) {
    throw new Error("배정된 시험을 찾지 못했습니다.");
  }

  const { data: existingAttempt, error: existingAttemptError } =
    await supabase
      .from("quiz_attempts")
      .select("id")
      .eq("student_id", studentId)
      .eq("assignment_id", assignmentId)
      .eq("status", "in_progress")
      .maybeSingle();
  if (existingAttemptError) {
    throw new Error("진행 중인 시험을 확인하지 못했습니다.");
  }
  if (existingAttempt) return existingAttempt.id;

  if (
    assignment.range_basis === "units" &&
    assignment.question_bank_version !== null
  ) {
    const { data, error } = await supabase.rpc(
      "create_quiz_attempt_from_bank",
      {
        p_student_id: studentId,
        p_assignment_id: assignmentId,
      },
    );

    if (error || typeof data !== "string") {
      const { data: recoveredAttempt } = await supabase
        .from("quiz_attempts")
        .select("id")
        .eq("student_id", studentId)
        .eq("assignment_id", assignmentId)
        .eq("status", "in_progress")
        .maybeSingle();
      if (recoveredAttempt) return recoveredAttempt.id;
      throw new Error("시험을 시작하지 못했습니다.");
    }

    return data;
  }

  const entryData: Array<{
    id: number;
    source_row: number;
    headword: string;
    headword_normalized: string;
    primary_meaning: string;
  }> = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data: page, error: entryError } = await supabase
      .from("vocab_entries")
      .select(
        "id, source_row, headword, headword_normalized, primary_meaning",
      )
      .eq("dataset_id", assignment.dataset_id)
      .gte("source_row", assignment.range_start)
      .lte("source_row", assignment.range_end)
      .order("source_row")
      .range(offset, offset + pageSize - 1);

    if (entryError) {
      throw new Error("시험 어휘를 불러오지 못했습니다.");
    }

    entryData.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
    offset += pageSize;
  }

  const uniqueEntries = new Map<string, QuizVocabularyEntry>();
  for (const entry of entryData) {
    const key = entry.headword_normalized.normalize("NFC").toLocaleLowerCase(
      "en-US",
    );
    if (!uniqueEntries.has(key)) {
      uniqueEntries.set(key, {
        id: entry.id,
        headword: entry.headword,
        primaryMeaning: entry.primary_meaning,
      });
    }
  }

  const questions = createQuizQuestions(
    [...uniqueEntries.values()],
    assignment.question_count,
    assignment.english_to_korean_ratio,
  );
  const { data, error } = await supabase.rpc("create_quiz_attempt", {
    p_student_id: studentId,
    p_assignment_id: assignmentId,
    p_questions: questions.map((question, index) => ({
      vocab_entry_id: question.vocabEntryId,
      order_index: index + 1,
      direction: question.direction,
      prompt: question.prompt,
      choices: question.choices,
      correct_choice_index: question.correctChoiceIndex,
    })),
  });

  if (error || typeof data !== "string") {
    const { data: recoveredAttempt } = await supabase
      .from("quiz_attempts")
      .select("id")
      .eq("student_id", studentId)
      .eq("assignment_id", assignmentId)
      .eq("status", "in_progress")
      .maybeSingle();
    if (recoveredAttempt) return recoveredAttempt.id;
    throw new Error("시험을 시작하지 못했습니다.");
  }

  return data;
}

export async function getStudentAttempt(
  studentId: string,
  attemptId: string,
): Promise<AttemptState | null> {
  const supabase = getServiceSupabaseClient();
  const { data: attemptData, error: attemptError } = await supabase
    .from("quiz_attempts")
    .select(
      "id, assignment_id, status, phase, started_at, deadline_at, current_question_started_at",
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (attemptError || !attemptData) {
    return null;
  }

  if (
    attemptData.status === "in_progress" &&
    attemptData.phase !== "review" &&
    new Date(attemptData.deadline_at).getTime() <= Date.now()
  ) {
    await expireStudentAttempt(studentId, attemptId);
    attemptData.status = "expired";
    attemptData.phase = "completed";
  }

  const [{ data: assignmentData }, { data: questionData }] =
    await Promise.all([
      supabase
        .from("assignments")
        .select("title, timing_mode, question_time_limit_seconds")
        .eq("id", attemptData.assignment_id)
        .maybeSingle(),
      supabase
        .from("quiz_questions")
        .select(
          "id, order_index, direction, prompt, choices, correct_choice_index, initial_choice_index, initial_is_correct, retry_choice_index, retry_is_correct, prior_wrong_count, initial_timed_out, retry_timed_out, assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey(headword_snapshot, primary_meaning_snapshot, provenance_status, exam_use_snapshot:assignment_question_exam_use_snapshot!assignment_question_exam_use_snapshot_question_fkey(headword_snapshot, primary_meaning_snapshot, display_pronunciation_ko_snapshot, pronunciation_snapshot, choice_dictionary_snapshots, provenance_status))",
        )
        .eq("attempt_id", attemptId)
        .order("order_index"),
    ]);

  const rows = (questionData ?? []) as QuestionRow[];
  const initialCurrent = rows.find(
    (question) => question.initial_choice_index === null,
  );
  const retryCurrent = rows.find(
    (question) =>
      question.initial_is_correct === false &&
      question.retry_choice_index === null,
  );
  const phase: AttemptState["phase"] =
    attemptData.status !== "in_progress"
      ? "completed"
      : attemptData.phase;
  const currentQuestionId =
    phase === "initial"
      ? (initialCurrent?.id ?? null)
      : phase === "retry"
        ? (retryCurrent?.id ?? null)
        : null;
  const timingMode =
    (assignmentData?.timing_mode as TimingMode | undefined) ?? "total";
  const questionTimeLimitSeconds =
    assignmentData?.question_time_limit_seconds ?? null;
  const timerDeadlineAt =
    timingMode === "per_question" && questionTimeLimitSeconds
      ? new Date(
          Date.parse(attemptData.current_question_started_at) +
            questionTimeLimitSeconds * 1000,
        ).toISOString()
      : attemptData.deadline_at;

  return {
    id: attemptData.id,
    assignmentTitle: assignmentData?.title ?? "단어 시험",
    status: attemptData.status,
    phase,
    startedAt: attemptData.started_at,
    deadlineAt: attemptData.deadline_at,
    timerDeadlineAt,
    timingMode,
    questionTimeLimitSeconds,
    currentQuestionId,
    questions: rows.map((question) => {
      const answered =
        question.initial_choice_index !== null ||
        question.retry_choice_index !== null;
      const bankQuestion = oneRelation(question.assignment_question);
      const examUseSnapshot = reviewedExamUseSnapshot(bankQuestion);
      const pronunciation = examUseSnapshot
        ? parseTargetPronunciation(
            examUseSnapshot.pronunciation_snapshot,
            examUseSnapshot.display_pronunciation_ko_snapshot,
          )
        : unavailablePronunciation();
      const choicePronunciations = examUseSnapshot
        ? parseChoicePronunciations(
            examUseSnapshot.choice_dictionary_snapshots,
            question.choices,
          )
        : question.choices.map(() => unavailablePronunciation());

      return {
        id: question.id,
        orderIndex: question.order_index,
        direction: question.direction,
        prompt: question.prompt,
        choices: question.choices,
        pronunciation,
        choicePronunciations,
        initialChoiceIndex: question.initial_choice_index,
        initialIsCorrect: question.initial_is_correct,
        retryChoiceIndex: question.retry_choice_index,
        retryIsCorrect: question.retry_is_correct,
        priorWrongLevel:
          question.prior_wrong_count >= 2
            ? 2
            : question.prior_wrong_count === 1
              ? 1
              : 0,
        initialTimedOut: Boolean(question.initial_timed_out),
        retryTimedOut: Boolean(question.retry_timed_out),
        revealedCorrectChoiceIndex: answered
          ? question.correct_choice_index
          : null,
      };
    }),
  };
}

export async function expireStudentAttempt(
  studentId: string,
  attemptId: string,
): Promise<void> {
  const supabase = getServiceSupabaseClient();
  const { error } = await supabase.rpc("expire_quiz_attempt", {
    p_student_id: studentId,
    p_attempt_id: attemptId,
  });

  if (error) {
    throw new Error("시험 종료상태를 저장하지 못했습니다.");
  }
}

export async function startStudentRetry(
  studentId: string,
  attemptId: string,
) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc("start_quiz_retry", {
    p_student_id: studentId,
    p_attempt_id: attemptId,
  });

  if (error || !data) {
    throw new Error("재시험을 시작하지 못했습니다.");
  }

  return data as {
    phase: "retry";
    nextQuestionId: string;
    deadlineAt: string;
  };
}

export async function answerStudentQuestion(input: {
  studentId: string;
  attemptId: string;
  questionId: string;
  phase: "initial" | "retry";
  choiceIndex: number;
}) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc("answer_quiz_question_v2", {
    p_student_id: input.studentId,
    p_attempt_id: input.attemptId,
    p_question_id: input.questionId,
    p_phase: input.phase,
    p_choice_index: input.choiceIndex,
    p_force_timeout: false,
  });

  if (error || !data) {
    throw new Error("답안을 저장하지 못했습니다.");
  }

  return data as {
    correct?: boolean;
    correctChoiceIndex?: number;
    completed?: boolean;
    needsRetry?: boolean;
    expired?: boolean;
    nextQuestionId?: string | null;
    nextPhase?: "initial" | "retry" | null;
    initialAnsweredCount?: number;
    initialQuestionCount?: number;
    retryAnsweredCount?: number;
    retryQuestionCount?: number;
    timedOut?: boolean;
    questionDeadlineAt?: string | null;
  };
}

export async function timeoutStudentQuestion(input: {
  studentId: string;
  attemptId: string;
  questionId: string;
  phase: "initial" | "retry";
}) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "answer_quiz_question_v2",
    {
      p_student_id: input.studentId,
      p_attempt_id: input.attemptId,
      p_question_id: input.questionId,
      p_phase: input.phase,
      p_choice_index: 0,
      p_force_timeout: true,
    },
  );
  if (error || !data) {
    throw new Error("시간 초과 상태를 저장하지 못했습니다.");
  }
  return data as {
    correct?: boolean;
    correctChoiceIndex?: number;
    completed?: boolean;
    needsRetry?: boolean;
    expired?: boolean;
    nextQuestionId?: string | null;
    nextPhase?: "initial" | "retry" | null;
    timedOut?: boolean;
    questionDeadlineAt?: string | null;
  };
}

export async function getAttemptResult(
  studentId: string,
  attemptId: string,
) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select(
      "id, assignment_id, status, phase, attempt_number, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, elapsed_seconds, started_at, initial_completed_at, completed_at, assignments(title)",
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  const questions = await getAttemptQuestionResults(attemptId);

  const assignment = Array.isArray(data.assignments)
    ? data.assignments[0]
    : data.assignments;
  const reviewing =
    data.status === "in_progress" && data.phase === "review";
  const reviewMetrics = reviewing
    ? deriveAttemptQuestionMetrics(questions)
    : null;
  const reviewElapsedSeconds =
    reviewing && data.initial_completed_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(data.initial_completed_at).getTime() -
              new Date(data.started_at).getTime()) /
              1000,
          ),
        )
      : null;

  return {
    id: data.id,
    title: assignment?.title ?? "단어 시험",
    status: data.status,
    phase: data.phase as AttemptState["phase"],
    attemptNumber: data.attempt_number,
    questionCount: data.question_count_snapshot,
    initialCorrectCount:
      reviewMetrics?.initialCorrectCount ?? data.initial_correct_count,
    retryCorrectCount:
      reviewMetrics?.retryCorrectCount ?? data.retry_correct_count,
    unresolvedWrongCount:
      reviewMetrics?.unresolvedWrongCount ??
      data.unresolved_wrong_count,
    initialScore:
      reviewMetrics?.initialScore ??
      (data.initial_score === null ? null : Number(data.initial_score)),
    finalScore: data.final_score === null ? null : Number(data.final_score),
    passed: data.passed,
    elapsedSeconds: reviewElapsedSeconds ?? data.elapsed_seconds,
    startedAt: data.started_at,
    initialCompletedAt: data.initial_completed_at,
    completedAt: data.completed_at,
    questions,
  };
}
