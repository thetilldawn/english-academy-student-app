import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  preservedAssignmentReplacementPlan,
  type AssignmentEditDraft,
  type AssignmentReplacementInput,
  type AssignmentReplacementResult,
  type AssignmentReviewSnapshotMode,
} from "@/lib/admin/assignment-edit";
import { assignmentReplacementFingerprintPayload } from "@/lib/admin/assignment-replacement-fingerprint";
import type { TimingMode } from "@/lib/admin/assignment-settings";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import { prepareRegularAssignment } from "@/lib/services/admin-service";
import { createTargetedQuizQuestions } from "@/lib/quiz/engine";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import {
  calculateAssignmentCapacity,
  MixedAssignmentError,
  prepareMixedAssignmentBatch,
} from "@/lib/services/mixed-assignment-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AssignmentCapacityInput } from "@/lib/validation";

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

type AssignmentQuestionPlan = {
  vocab_entry_id: number;
  base_order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  choice_vocab_entry_ids: number[];
};

type EditableSourceContext = {
  draft: AssignmentEditDraft;
  questions: AssignmentQuestionPlan[] | null;
  selectedQueueIds: string[];
  selectedReviewVocabEntryIds: number[];
};

const replacementResultSchema = z.object({
  status: z.literal("replaced"),
  sourceAssignmentId: z.uuid(),
  replacementAssignmentId: z.uuid(),
  studentId: z.uuid(),
  replacementPurpose: z.enum(["regular", "mixed", "review"]),
  idempotent: z.boolean(),
});

export type AssignmentReplacementFailureReason =
  | "forbidden"
  | "not_found"
  | "blocked"
  | "started"
  | "completed"
  | "missed"
  | "cancelled"
  | "deleted"
  | "closed"
  | "deadline_elapsed"
  | "unavailable"
  | "conflict"
  | "invalid_selection"
  | "database";

const failureMessages: Record<
  AssignmentReplacementFailureReason,
  string
> = {
  forbidden: "관리자 권한을 다시 확인해 주세요.",
  not_found: "수정할 학생 배정을 찾지 못했습니다.",
  blocked: "이용이 중지된 학생의 배정은 수정할 수 없습니다.",
  started: "학생이 이미 응시를 시작해 이 배정은 수정할 수 없습니다.",
  completed: "이미 완료되었거나 시간 종료된 시험은 수정할 수 없습니다.",
  missed: "이미 미응시로 마감된 배정은 수정할 수 없습니다.",
  cancelled: "이미 취소된 배정은 수정할 수 없습니다.",
  deleted: "삭제된 학생 또는 시험 배정은 수정할 수 없습니다.",
  closed: "종료된 시험 배정은 수정할 수 없습니다.",
  deadline_elapsed: "응시 시작 마감이 지난 배정은 수정할 수 없습니다.",
  unavailable: "마감되었거나 현재 사용할 수 없는 배정입니다.",
  conflict: "배정 상태가 바뀌었습니다. 새로고침 후 다시 시도해 주세요.",
  invalid_selection: "수정할 시험 범위와 조건을 다시 확인해 주세요.",
  database: "배정을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

export class AssignmentReplacementError extends Error {
  constructor(
    public readonly reason: AssignmentReplacementFailureReason,
    message = failureMessages[reason],
  ) {
    super(message);
    this.name = "AssignmentReplacementError";
  }
}

function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapDatabaseFailure(error: {
  code?: string;
  message?: string;
}): AssignmentReplacementError {
  const message = error.message ?? "";
  if (error.code === "42501" || /forbidden/.test(message)) {
    return new AssignmentReplacementError("forbidden");
  }
  if (
    error.code === "P0002" ||
    /assignment_student_not_found/.test(message)
  ) {
    return new AssignmentReplacementError("not_found");
  }
  if (/assignment_already_started/.test(message)) {
    return new AssignmentReplacementError("started");
  }
  if (/assignment_already_completed/.test(message)) {
    return new AssignmentReplacementError("completed");
  }
  if (/assignment_already_missed/.test(message)) {
    return new AssignmentReplacementError("missed");
  }
  if (/assignment_already_cancelled/.test(message)) {
    return new AssignmentReplacementError("cancelled");
  }
  if (/student_deleted|assignment_deleted/.test(message)) {
    return new AssignmentReplacementError("deleted");
  }
  if (/student_not_active/.test(message)) {
    return new AssignmentReplacementError("blocked");
  }
  if (/assignment_not_active/.test(message)) {
    return new AssignmentReplacementError("closed");
  }
  if (
    /assignment_unavailable|assignment_deadline_elapsed|assignment_replacement_deadline_elapsed/.test(
      message,
    )
  ) {
    return new AssignmentReplacementError("deadline_elapsed");
  }
  if (/assignment_replacement_persistence_mismatch/.test(message)) {
    return new AssignmentReplacementError("database");
  }
  if (/dataset_not_ready/.test(message)) {
    return new AssignmentReplacementError("unavailable");
  }
  if (
    error.code === "40001" ||
    /idempotency_key_reused|snapshot_changed|already_active/.test(message)
  ) {
    return new AssignmentReplacementError(
      "conflict",
      /idempotency_key_reused/.test(message)
        ? "같은 수정 요청 키에 다른 조건이 사용되었습니다. 다시 열어 시도해 주세요."
        : failureMessages.conflict,
    );
  }
  if (error.code === "21000") {
    return new AssignmentReplacementError("database");
  }
  if (["22023", "23503", "23505"].includes(error.code ?? "")) {
    return new AssignmentReplacementError("invalid_selection");
  }
  return new AssignmentReplacementError("database");
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

async function requireEditableSourceContext(
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
      questionOrderMode: assignment.question_order_mode,
      availableUntil: assignment.available_until,
      includePendingReview:
        sourceSnapshot.selectedQueueIds.length > 0,
      reviewLevels: sourceSnapshot.reviewLevels,
    },
    questions: sourceSnapshot.questions,
    selectedQueueIds: sourceSnapshot.selectedQueueIds,
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

function sameOrderedValues(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function canReuseSourceQuestions(
  source: EditableSourceContext,
  input: AssignmentReplacementInput,
) {
  const before = source.draft;
  return (
    source.questions !== null &&
    before.datasetId === input.datasetId &&
    sameOrderedValues(before.primaryUnitIds, input.primaryUnitIds) &&
    before.questionCount === input.questionCount &&
    before.englishToKoreanRatio === input.englishToKoreanRatio &&
    before.includePendingReview === input.includePendingReview &&
    (!before.includePendingReview ||
      sameOrderedValues(
        [...before.reviewLevels].toSorted(),
        [...input.reviewLevels].toSorted(),
      ))
  );
}

function assertExactReviewShape(
  source: EditableSourceContext,
  input: Pick<
    AssignmentReplacementInput,
    | "datasetId"
    | "primaryUnitIds"
    | "questionCount"
    | "includePendingReview"
    | "reviewLevels"
  >,
) {
  const before = source.draft;
  if (
    !input.includePendingReview ||
    input.datasetId !== before.datasetId ||
    !sameOrderedValues(input.primaryUnitIds, before.primaryUnitIds) ||
    input.questionCount !== source.selectedQueueIds.length ||
    !sameOrderedValues(
      [...input.reviewLevels].toSorted(),
      [...before.reviewLevels].toSorted(),
    )
  ) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      "오답 시험은 대상 단어를 유지한 채 제목·출제 방향·순서·시간·통과 점수·마감만 수정할 수 있습니다.",
    );
  }
}

async function prepareExactReviewQuestions(
  source: EditableSourceContext,
  englishToKoreanRatio: 0 | 50 | 100,
  deterministic = false,
): Promise<AssignmentQuestionPlan[]> {
  const supabase = await createServerSupabaseClient();
  const candidates = await loadEligibleVocabularyDataset(
    supabase,
    source.draft.datasetId,
    { includeExamUseProjection: true },
  );
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const targets = source.selectedReviewVocabEntryIds.flatMap(
    (vocabEntryId) => {
      const candidate = candidateById.get(vocabEntryId);
      return candidate ? [candidate] : [];
    },
  );
  if (targets.length !== source.selectedReviewVocabEntryIds.length) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      "오답 시험 대상 중 현재 출제할 수 없는 단어가 있습니다.",
    );
  }

  let drafts;
  try {
    drafts = createTargetedQuizQuestions(
      targets,
      candidates,
      englishToKoreanRatio,
      deterministic ? () => 0.5 : undefined,
    );
  } catch (error) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      error instanceof Error
        ? error.message
        : "오답 시험 문항을 다시 만들 수 없습니다.",
    );
  }
  return drafts.map((question, index) => ({
    vocab_entry_id: question.vocabEntryId,
    base_order_index: index + 1,
    direction: question.direction,
    choice_vocab_entry_ids: question.choiceVocabEntryIds,
  }));
}

export async function calculateStudentAssignmentReplacementCapacity(
  assignmentId: string,
  studentId: string,
  input: AssignmentCapacityInput,
  authenticatedAdmin?: AdminContext,
) {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const source = await requireEditableSourceContext(
    assignmentId,
    studentId,
    admin,
  );
  if (input.studentId !== studentId) {
    throw new AssignmentReplacementError("invalid_selection");
  }
  if (source.draft.purpose === "review") {
    assertExactReviewShape(source, {
      datasetId: input.datasetId,
      primaryUnitIds: input.primaryUnitIds,
      questionCount: source.draft.questionCount,
      includePendingReview: input.includePendingReview,
      reviewLevels: input.reviewLevels,
    });
    const count =
      source.questions &&
      input.englishToKoreanRatio ===
        source.draft.englishToKoreanRatio
        ? source.questions.length
        : (
            await prepareExactReviewQuestions(
              source,
              input.englishToKoreanRatio,
              true,
            )
          ).length;
    return {
      eligibleBeforeActiveAssignment: 0,
      activeAssignmentExcluded: 0,
      questionPlanExcluded: 0,
      unitEligible: 0,
      wrongEligible: count,
      wrongLevel1Eligible: source.draft.reviewLevels.includes(1)
        ? count
        : 0,
      wrongLevel2Eligible: source.draft.reviewLevels.includes(2)
        ? count
        : 0,
      overlap: 0,
      alreadyAssigned: 0,
      maximumQuestionCount: count,
      recommendedQuestionCount: count,
      minimumQuestionCount: count,
    };
  }
  try {
    return await calculateAssignmentCapacity(input, admin, {
      assignmentId,
      studentId,
    });
  } catch (error) {
    if (error instanceof MixedAssignmentError) {
      throw new AssignmentReplacementError(
        error.reason === "forbidden"
          ? "forbidden"
          : error.reason === "database"
            ? "database"
            : error.reason === "conflict"
              ? "conflict"
              : "invalid_selection",
        error.message,
      );
    }
    throw error;
  }
}

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
) {
  const lookup = await supabase.rpc(
    "get_student_assignment_replacement_result_v1",
    {
      p_source_assignment_id: assignmentId,
      p_student_id: studentId,
      p_idempotency_key: idempotencyKey,
      p_request_sha256: requestSha256,
    },
  );
  if (lookup.error) {
    throw mapDatabaseFailure(lookup.error);
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
  const previous = await lookupReplacementResult(
    supabase,
    assignmentId,
    studentId,
    input.idempotencyKey,
    requestSha256,
  );
  if (previous) return previous;

  const exclusion = { assignmentId, studentId };
  let replacementKind: "regular" | "mixed" | "review";
  let reviewSnapshotMode: AssignmentReviewSnapshotMode;
  let prepared: {
    title: string;
    datasetId: string;
    primaryUnitIds: string[];
    questionCount: number;
    englishToKoreanRatio: 0 | 50 | 100;
    timeLimitSeconds: number;
    passingScore: number;
    questionOrderMode: AssignmentReplacementInput["questionOrderMode"];
    availableUntil: string | null;
    timingMode: AssignmentReplacementInput["timingMode"];
    questionTimeLimitSeconds: number | null;
    reviewLevels: (1 | 2)[];
    selectedQueueIds: string[];
    questions: AssignmentQuestionPlan[];
  };
  try {
    const source = await requireEditableSourceContext(
      assignmentId,
      studentId,
      admin,
    );
    if (source.draft.purpose === "review") {
      assertExactReviewShape(source, input);
    }

    if (canReuseSourceQuestions(source, input)) {
      const replacementPlan = preservedAssignmentReplacementPlan(
        source.draft.purpose,
        input.includePendingReview,
      );
      replacementKind = replacementPlan.kind;
      reviewSnapshotMode = replacementPlan.reviewSnapshotMode;
      prepared = {
        title: input.title.trim(),
        datasetId: input.datasetId,
        primaryUnitIds:
          replacementKind === "review" ? [] : input.primaryUnitIds,
        questionCount: input.questionCount,
        englishToKoreanRatio: input.englishToKoreanRatio,
        timeLimitSeconds: input.timeLimitSeconds,
        passingScore: input.passingScore,
        questionOrderMode: input.questionOrderMode,
        availableUntil: input.availableUntil,
        timingMode: input.timingMode,
        questionTimeLimitSeconds: input.questionTimeLimitSeconds,
        reviewLevels: input.includePendingReview
          ? [...input.reviewLevels].toSorted()
          : [],
        selectedQueueIds: input.includePendingReview
          ? source.selectedQueueIds
          : [],
        questions: source.questions!,
      };
    } else if (source.draft.purpose === "review") {
      replacementKind = "review";
      reviewSnapshotMode = "preserve";
      prepared = {
        title: input.title.trim(),
        datasetId: input.datasetId,
        primaryUnitIds: [],
        questionCount: input.questionCount,
        englishToKoreanRatio: input.englishToKoreanRatio,
        timeLimitSeconds: input.timeLimitSeconds,
        passingScore: input.passingScore,
        questionOrderMode: input.questionOrderMode,
        availableUntil: input.availableUntil,
        timingMode: input.timingMode,
        questionTimeLimitSeconds: input.questionTimeLimitSeconds,
        reviewLevels: [...input.reviewLevels].toSorted(),
        selectedQueueIds: source.selectedQueueIds,
        questions: await prepareExactReviewQuestions(
          source,
          input.englishToKoreanRatio,
        ),
      };
    } else if (input.includePendingReview) {
      replacementKind = "mixed";
      reviewSnapshotMode = "recalculate";
      const mixed = await prepareMixedAssignmentBatch(
        {
          studentId,
          datasetId: input.datasetId,
          primaryUnitIds: input.primaryUnitIds,
          reviewLevels: input.reviewLevels,
          totalQuestionCount: input.questionCount,
          title: input.title.trim(),
          englishToKoreanRatio: input.englishToKoreanRatio,
          timeLimitSeconds: input.timeLimitSeconds,
          timingMode: input.timingMode,
          questionTimeLimitSeconds: input.questionTimeLimitSeconds,
          passingScore: input.passingScore,
          questionOrderMode: input.questionOrderMode,
          availableUntil: input.availableUntil,
        },
        admin,
        exclusion,
      );
      prepared = {
        ...mixed,
        questionCount: input.questionCount,
      };
    } else {
      replacementKind = "regular";
      reviewSnapshotMode = "none";
      const regular = await prepareRegularAssignment(
        {
          title: input.title.trim(),
          datasetId: input.datasetId,
          unitIds: input.primaryUnitIds,
          questionCount: input.questionCount,
          englishToKoreanRatio: input.englishToKoreanRatio,
          timeLimitSeconds: input.timeLimitSeconds,
          timingMode: input.timingMode,
          questionTimeLimitSeconds: input.questionTimeLimitSeconds,
          passingScore: input.passingScore,
          questionOrderMode: input.questionOrderMode,
          availableUntil: input.availableUntil,
          studentIds: [studentId],
        },
        admin,
        exclusion,
      );
      prepared = {
        title: regular.title,
        datasetId: regular.datasetId,
        primaryUnitIds: regular.unitIds,
        questionCount: regular.questionCount,
        englishToKoreanRatio: regular.englishToKoreanRatio,
        timeLimitSeconds: regular.timeLimitSeconds,
        passingScore: regular.passingScore,
        questionOrderMode: regular.questionOrderMode,
        availableUntil: regular.availableUntil,
        timingMode: regular.timingMode,
        questionTimeLimitSeconds: regular.questionTimeLimitSeconds,
        reviewLevels: [],
        selectedQueueIds: [],
        questions: regular.questions,
      };
    }
  } catch (error) {
    const concurrentResult = await lookupReplacementResult(
      supabase,
      assignmentId,
      studentId,
      input.idempotencyKey,
      requestSha256,
    );
    if (concurrentResult) return concurrentResult;
    if (error instanceof MixedAssignmentError) {
      throw new AssignmentReplacementError(
        error.reason === "forbidden"
          ? "forbidden"
          : error.reason === "database"
            ? "database"
            : error.reason === "conflict"
              ? "conflict"
              : "invalid_selection",
        error.message,
      );
    }
    if (error instanceof AssignmentReplacementError) throw error;
    console.error("[assignment-replacement] preparation failed", error);
    throw new AssignmentReplacementError("database");
  }

  const { data, error } = await supabase.rpc(
    "replace_student_assignment_v4",
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
      p_question_order_mode: prepared.questionOrderMode,
      p_available_until: prepared.availableUntil,
      p_timing_mode: prepared.timingMode,
      p_question_time_limit_seconds:
        prepared.questionTimeLimitSeconds,
      p_review_levels: prepared.reviewLevels,
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
    );
    if (concurrentResult) return concurrentResult;
    console.error("[assignment-replacement] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw mapDatabaseFailure(error);
  }
  const result = replacementResultSchema.safeParse(data);
  if (!result.success) {
    throw new AssignmentReplacementError("database");
  }
  return result.data;
}
