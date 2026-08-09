import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  resolveBulkAssignmentSeries,
  unitRangeLabel,
} from "@/lib/admin/bulk-assignment-range";
import { resolveBulkAssignmentSchedule } from "@/lib/admin/bulk-assignment-schedule";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import { buildStudentProgress } from "@/lib/admin/progress";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  listAssignmentHistory,
  listDatasets,
  listStudents,
  listVocabUnits,
  prepareRegularAssignment,
} from "@/lib/services/admin-service";
import {
  calculateAssignmentCapacity,
  MixedAssignmentError,
  prepareMixedAssignmentBatch,
} from "@/lib/services/mixed-assignment-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  BulkAssignmentInput,
  BulkAssignmentPreviewInput,
} from "@/lib/validation";

export type BulkAssignmentPreviewSession = {
  sessionNumber: number;
  available: boolean;
  unitId: string | null;
  unitLabel: string | null;
  unitIds: string[];
  unitLabels: string[];
  rangeTruncated: boolean;
  questionCount: number;
  wrongCount: number;
  availableFrom: string;
  availableUntil: string | null;
  error: string | null;
};

export type BulkAssignmentPreviewItem = {
  studentId: string;
  studentName: string;
  available: boolean;
  datasetId: string | null;
  datasetLabel: string | null;
  sessions: BulkAssignmentPreviewSession[];
  error: string | null;
};

export type BulkAssignmentPreview = {
  items: BulkAssignmentPreviewItem[];
  assignableCount: number;
  blockedCount: number;
  assignmentCount: number;
};

const bulkAssignmentResultSchema = z.array(
  z.object({
    student_id: z.uuid(),
    assignment_id: z.uuid(),
    session_number: z.coerce.number().int().positive(),
  }),
);

export type BulkAssignmentResult = z.infer<
  typeof bulkAssignmentResultSchema
>[number];

export class BulkAssignmentError extends Error {
  constructor(
    public readonly reason:
      | "invalid_selection"
      | "conflict"
      | "database",
    message = "일괄 단어 시험을 배정하지 못했습니다.",
  ) {
    super(message);
    this.name = "BulkAssignmentError";
  }
}

function bulkDatabaseError(error: { code?: string; message?: string }) {
  const message = error.message ?? "";
  if (
    error.code === "40001" ||
    error.code === "23505" ||
    message.includes("snapshot_changed") ||
    message.includes("selection_changed") ||
    message.includes("idempotency_key_reused")
  ) {
    return new BulkAssignmentError(
      "conflict",
      "배정 조건 또는 학생 상태가 바뀌었습니다. 목록을 새로고침한 뒤 다시 배정해 주세요.",
    );
  }
  if (
    message.includes("exam_use_release_inactive") ||
    message.includes("active_exam_use_release_not_found") ||
    message.includes("exam_use_dataset_snapshot_mismatch")
  ) {
    return new BulkAssignmentError(
      "invalid_selection",
      "선택한 단어장의 시험용 데이터가 준비되지 않았습니다. 단어장을 다시 확인해 주세요.",
    );
  }
  if (
    message.includes("capability_unavailable") ||
    message.includes("not_eligible_for_direction") ||
    message.includes("question_plan") ||
    message.includes("question_choices") ||
    message.includes("choice_values_not_distinct")
  ) {
    return new BulkAssignmentError(
      "invalid_selection",
      "선택한 범위에서 현재 출제 방식에 맞는 문항을 만들 수 없습니다. 범위 또는 출제 방식을 확인해 주세요.",
    );
  }
  if (
    message.includes("review_target") ||
    message.includes("review_queue") ||
    message.includes("pending_review")
  ) {
    return new BulkAssignmentError(
      "invalid_selection",
      "포함할 틀린 단어 상태를 다시 확인해 주세요.",
    );
  }
  return new BulkAssignmentError(
    ["21000", "22023", "23503"].includes(error.code ?? "")
      ? "invalid_selection"
      : "database",
  );
}

function unavailableReason(
  reason:
    | "assigned"
    | "resume"
    | "complete"
    | "manual"
    | "first"
    | "next"
    | "repeat"
    | null,
) {
  if (reason === "assigned") {
    return "아직 시작하지 않은 단어 시험이 있습니다.";
  }
  if (reason === "resume") {
    return "진행 중인 단어 시험이 있습니다.";
  }
  if (reason === "complete") {
    return "현재 단어장의 마지막 범위까지 통과했습니다.";
  }
  if (reason === "manual") {
    return "과거 시험의 범위를 자동으로 확인할 수 없습니다.";
  }
  return null;
}

function emptySessionError(sessionNumber: number) {
  return `${sessionNumber}회차에 배정할 다음 DAY가 없습니다. 시험 횟수나 회차당 DAY 수를 줄여 주세요.`;
}

export async function previewBulkAssignments(
  input: BulkAssignmentPreviewInput,
  authenticatedAdmin?: AdminContext,
): Promise<BulkAssignmentPreview> {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const [students, datasets, units, history] = await Promise.all([
    listStudents(),
    listDatasets(),
    listVocabUnits(),
    listAssignmentHistory(),
  ]);
  const studentById = new Map(
    students.map((student) => [student.id, student]),
  );
  const datasetById = new Map(
    datasets.map((dataset) => [dataset.id, dataset]),
  );
  const unitsByDataset = new Map<string, typeof units>();
  for (const unit of units) {
    const datasetUnits = unitsByDataset.get(unit.datasetId) ?? [];
    datasetUnits.push(unit);
    unitsByDataset.set(unit.datasetId, datasetUnits);
  }
  const progressByStudent = new Map(
    buildStudentProgress(students, units, history).map((item) => [
      item.studentId,
      item,
    ]),
  );
  const schedule = resolveBulkAssignmentSchedule(input);

  const items = await Promise.all(
    input.studentIds.map(async (studentId) => {
      const student = studentById.get(studentId);
      const progress = progressByStudent.get(studentId);
      const progressBlockedReason = progress
        ? unavailableReason(progress.recommendationReason)
        : null;
      const dataset = progress?.recommendedDatasetId
        ? datasetById.get(progress.recommendedDatasetId)
        : null;
      let rangeError: string | null = null;
      let resolvedSessions: ReturnType<
        typeof resolveBulkAssignmentSeries<(typeof units)[number]>
      >["sessions"] = [];
      if (
        progress?.recommendedDatasetId &&
        progress.recommendedUnitIds.length > 0
      ) {
        try {
          resolvedSessions = resolveBulkAssignmentSeries(
            unitsByDataset.get(progress.recommendedDatasetId) ?? [],
            progress,
            input.rangeMode,
            input.unitsPerSession,
            input.sessionCount,
          ).sessions;
        } catch {
          rangeError = "학생의 다음 DAY 범위를 자동으로 확인할 수 없습니다.";
        }
      }
      const blockedReason =
        progressBlockedReason ??
        rangeError ??
        (dataset && !dataset.isAssignable
          ? "최근 단어장을 신규 배정 가능한 자료로 바꿔 주세요."
          : null);
      const itemBase = {
        studentId,
        studentName: student?.displayName ?? "확인할 수 없는 학생",
        datasetId: progress?.recommendedDatasetId ?? null,
        datasetLabel: dataset
          ? cataloguedDatasetDisplayLabel(dataset)
          : null,
      };

      if (!student || student.status !== "active") {
        return {
          ...itemBase,
          available: false,
          sessions: [],
          error: "접속 가능한 학생이 아닙니다.",
        };
      }
      if (blockedReason) {
        return {
          ...itemBase,
          available: false,
          sessions: [],
          error: blockedReason,
        };
      }
      if (
        !progress?.recommendedDatasetId ||
        resolvedSessions.length !== input.sessionCount ||
        !dataset ||
        dataset.status !== "ready" ||
        !dataset.isActive
      ) {
        return {
          ...itemBase,
          available: false,
          sessions: [],
          error: "사용할 단어장이나 다음 범위를 정해야 합니다.",
        };
      }

      const sessions: BulkAssignmentPreviewSession[] = [];
      for (const [index, resolved] of resolvedSessions.entries()) {
        const previewSession = await (async () => {
          const scheduled = schedule[index];
          const unitIds = resolved.units.map((unit) => unit.id);
          const sessionBase = {
            sessionNumber: resolved.sessionNumber,
            unitId: resolved.units[0]?.id ?? null,
            unitLabel: unitRangeLabel(resolved.units),
            unitIds,
            unitLabels: resolved.units.map((unit) => unit.label),
            rangeTruncated: resolved.truncated,
            availableFrom: scheduled.availableFrom,
            availableUntil: scheduled.availableUntil,
          };
          if (unitIds.length === 0) {
            return {
              ...sessionBase,
              available: false,
              questionCount: 0,
              wrongCount: 0,
              error: emptySessionError(resolved.sessionNumber),
            };
          }
          const includeReview =
            input.includePendingReview && resolved.sessionNumber === 1;
          try {
            const capacity = await calculateAssignmentCapacity(
              {
                studentId,
                datasetId: dataset.id,
                primaryUnitIds: unitIds,
                includePendingReview: includeReview,
                reviewLevels: input.reviewLevels,
                englishToKoreanRatio: input.englishToKoreanRatio,
              },
              admin,
            );
            const error =
              includeReview && capacity.wrongEligible < 1
                ? "다음 시험에 추가 가능한 틀린 단어가 없습니다."
                : includeReview &&
                    capacity.recommendedQuestionCount <= capacity.wrongEligible
                  ? "첫 회차에 새 DAY 단어를 하나 이상 포함할 수 없습니다."
                : capacity.maximumQuestionCount < capacity.minimumQuestionCount
                  ? "현재 범위에서 만들 수 있는 문항이 부족합니다."
                  : null;
            return {
              ...sessionBase,
              available: error === null,
              questionCount: error ? 0 : capacity.recommendedQuestionCount,
              wrongCount: includeReview ? capacity.wrongEligible : 0,
              error,
            };
          } catch (error) {
            return {
              ...sessionBase,
              available: false,
              questionCount: 0,
              wrongCount: 0,
              error:
                error instanceof Error
                  ? error.message
                  : "배정 가능 범위를 계산하지 못했습니다.",
            };
          }
        })();
        sessions.push(previewSession);
      }
      const firstError = sessions.find((session) => !session.available)?.error;
      return {
        ...itemBase,
        available: sessions.every((session) => session.available),
        sessions,
        error: firstError ?? null,
      };
    }),
  );

  return {
    items,
    assignableCount: items.filter((item) => item.available).length,
    blockedCount: items.filter((item) => !item.available).length,
    assignmentCount: items.reduce(
      (count, item) =>
        count + item.sessions.filter((session) => session.available).length,
      0,
    ),
  };
}

function bulkAssignmentRequestSha256(input: BulkAssignmentInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        studentIds: [...input.studentIds].toSorted(),
        rangeMode: input.rangeMode,
        unitsPerSession: input.unitsPerSession,
        sessionCount: input.sessionCount,
        firstAvailableFrom: input.firstAvailableFrom,
        dayInterval: input.dayInterval,
        firstAvailableUntil: input.firstAvailableUntil,
        includePendingReview: input.includePendingReview,
        reviewLevels: [...input.reviewLevels].toSorted(),
        englishToKoreanRatio: input.englishToKoreanRatio,
        timeLimitSeconds: input.timeLimitSeconds,
        passingScore: input.passingScore,
        questionOrderMode: input.questionOrderMode,
        timingMode: input.timingMode,
        questionTimeLimitSeconds: input.questionTimeLimitSeconds,
      }),
      "utf8",
    )
    .digest("hex");
}

async function lookupBulkAssignmentResult(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  input: BulkAssignmentInput,
  requestSha256: string,
) {
  const lookup = await supabase.rpc("get_bulk_vocab_series_result_v1", {
    p_idempotency_key: input.idempotencyKey,
    p_request_sha256: requestSha256,
  });
  if (lookup.error) throw bulkDatabaseError(lookup.error);
  if (lookup.data === null) return null;
  const previous = bulkAssignmentResultSchema.safeParse(lookup.data);
  if (!previous.success) throw new BulkAssignmentError("database");
  return previous.data;
}

export async function createBulkAssignments(
  input: BulkAssignmentInput,
  authenticatedAdmin?: AdminContext,
): Promise<BulkAssignmentResult[]> {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const supabase = await createServerSupabaseClient();
  const requestSha256 = bulkAssignmentRequestSha256(input);
  const previous = await lookupBulkAssignmentResult(
    supabase,
    input,
    requestSha256,
  );
  if (previous) return previous;

  if (
    input.firstAvailableUntil &&
    Date.parse(input.firstAvailableUntil) <= Date.now()
  ) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "첫 시험 마감은 현재보다 뒤로 정해 주세요.",
    );
  }

  let preview: BulkAssignmentPreview;
  try {
    preview = await previewBulkAssignments(input, admin);
  } catch (error) {
    const concurrent = await lookupBulkAssignmentResult(
      supabase,
      input,
      requestSha256,
    );
    if (concurrent) return concurrent;
    throw error;
  }
  const blocked = preview.items.filter((item) => !item.available);
  if (blocked.length > 0) {
    const concurrent = await lookupBulkAssignmentResult(
      supabase,
      input,
      requestSha256,
    );
    if (concurrent) return concurrent;
    throw new BulkAssignmentError(
      "invalid_selection",
      `${blocked[0]?.studentName ?? "학생"}: ${blocked[0]?.error ?? "배정 조건을 확인해 주세요."}`,
    );
  }

  let batches: Record<string, unknown>[];
  try {
    batches = [];
    for (
      let sessionIndex = 0;
      sessionIndex < input.sessionCount;
      sessionIndex += 1
    ) {
      const sessionBatches = await Promise.all(
        preview.items.map(async (item) => {
              const session = item.sessions[sessionIndex];
              if (
                !item.datasetId ||
                !session ||
                session.unitIds.length < 1 ||
                session.questionCount < 1
              ) {
                throw new BulkAssignmentError("invalid_selection");
              }
              if (
                input.includePendingReview &&
                session.sessionNumber === 1
              ) {
                const prepared = await prepareMixedAssignmentBatch(
                  {
                    studentId: item.studentId,
                    datasetId: item.datasetId,
                    primaryUnitIds: session.unitIds,
                    reviewLevels: input.reviewLevels,
                    englishToKoreanRatio: input.englishToKoreanRatio,
                    totalQuestionCount: session.questionCount,
                    title: "",
                    timeLimitSeconds: input.timeLimitSeconds,
                    passingScore: input.passingScore,
                    questionOrderMode: input.questionOrderMode,
                    availableUntil: session.availableUntil,
                    timingMode: input.timingMode,
                    questionTimeLimitSeconds:
                      input.questionTimeLimitSeconds,
                  },
                  admin,
                );
                return {
                  kind: "mixed",
                  student_id: prepared.studentId,
                  dataset_id: prepared.datasetId,
                  review_levels: prepared.reviewLevels,
                  review_scope: prepared.reviewScope,
                  selected_queue_ids: prepared.selectedQueueIds,
                  title: prepared.title,
                  unit_ids: prepared.primaryUnitIds,
                  english_to_korean_ratio:
                    prepared.englishToKoreanRatio,
                  question_count: session.questionCount,
                  time_limit_seconds: prepared.timeLimitSeconds,
                  passing_score: prepared.passingScore,
                  question_order_mode: prepared.questionOrderMode,
                  available_from: session.availableFrom,
                  available_until: prepared.availableUntil,
                  timing_mode: prepared.timingMode,
                  question_time_limit_seconds:
                    prepared.questionTimeLimitSeconds,
                  session_number: session.sessionNumber,
                  session_count: input.sessionCount,
                  questions: prepared.questions,
                };
              }

              const prepared = await prepareRegularAssignment(
                {
                  title: "",
                  datasetId: item.datasetId,
                  unitIds: session.unitIds,
                  questionCount: session.questionCount,
                  englishToKoreanRatio: input.englishToKoreanRatio,
                  timeLimitSeconds: input.timeLimitSeconds,
                  timingMode: input.timingMode,
                  questionTimeLimitSeconds:
                    input.questionTimeLimitSeconds,
                  passingScore: input.passingScore,
                  questionOrderMode: input.questionOrderMode,
                  availableUntil: session.availableUntil,
                  studentIds: [item.studentId],
                },
                admin,
              );
              return {
                kind: "regular",
                student_id: item.studentId,
                dataset_id: prepared.datasetId,
                unit_ids: prepared.unitIds,
                title: prepared.title,
                question_count: prepared.questionCount,
                english_to_korean_ratio:
                  prepared.englishToKoreanRatio,
                time_limit_seconds: prepared.timeLimitSeconds,
                passing_score: prepared.passingScore,
                question_order_mode: prepared.questionOrderMode,
                available_from: session.availableFrom,
                available_until: prepared.availableUntil,
                timing_mode: prepared.timingMode,
                question_time_limit_seconds:
                  prepared.questionTimeLimitSeconds,
                session_number: session.sessionNumber,
                session_count: input.sessionCount,
                questions: prepared.questions,
              };
        }),
      );
      batches.push(...sessionBatches);
    }
  } catch (error) {
    const concurrent = await lookupBulkAssignmentResult(
      supabase,
      input,
      requestSha256,
    );
    if (concurrent) return concurrent;
    if (error instanceof BulkAssignmentError) throw error;
    if (error instanceof MixedAssignmentError) {
      throw new BulkAssignmentError(
        error.reason === "conflict" ? "conflict" : "invalid_selection",
        error.message,
      );
    }
    throw new BulkAssignmentError(
      "invalid_selection",
      error instanceof Error
        ? error.message
        : "학생별 문항을 만들지 못했습니다.",
    );
  }

  const { data, error } = await supabase.rpc(
    "create_bulk_vocab_assignments_v5",
    {
      p_idempotency_key: input.idempotencyKey,
      p_request_sha256: requestSha256,
      p_batches: batches,
    },
  );
  if (error) {
    console.error("[bulk-assignment-series] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    const concurrent = await lookupBulkAssignmentResult(
      supabase,
      input,
      requestSha256,
    );
    if (concurrent) return concurrent;
    throw bulkDatabaseError(error);
  }

  const result = bulkAssignmentResultSchema.safeParse(data);
  if (!result.success || result.data.length !== batches.length) {
    throw new BulkAssignmentError("database");
  }
  return result.data;
}
