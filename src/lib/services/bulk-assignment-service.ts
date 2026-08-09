import "server-only";

import { z } from "zod";

import { buildStudentProgress } from "@/lib/admin/progress";
import {
  resolveBulkAssignmentRange,
  unitRangeLabel,
} from "@/lib/admin/bulk-assignment-range";
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
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
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

export type BulkAssignmentPreviewItem = {
  studentId: string;
  studentName: string;
  available: boolean;
  datasetId: string | null;
  datasetLabel: string | null;
  unitId: string | null;
  unitLabel: string | null;
  unitIds: string[];
  unitLabels: string[];
  rangeTruncated: boolean;
  questionCount: number;
  wrongCount: number;
  error: string | null;
};

export type BulkAssignmentPreview = {
  items: BulkAssignmentPreviewItem[];
  assignableCount: number;
  blockedCount: number;
};

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

function bulkDatabaseError(error: {
  code?: string;
  message?: string;
}) {
  const message = error.message ?? "";
  if (
    error.code === "40001" ||
    error.code === "23505" ||
    message.includes("snapshot_changed") ||
    message.includes("selection_changed")
  ) {
    return new BulkAssignmentError(
      "conflict",
      "학생의 시험 또는 틀린 단어 상태가 바뀌었습니다. 목록을 새로고침한 뒤 다시 배정해 주세요.",
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
      let selectedUnits: typeof units = [];
      let rangeTruncated = false;
      let rangeError: string | null = null;
      if (
        progress?.recommendedDatasetId &&
        progress.recommendedUnitIds.length > 0
      ) {
        try {
          const resolvedRange = resolveBulkAssignmentRange(
            unitsByDataset.get(progress.recommendedDatasetId) ?? [],
            progress,
            input.rangeMode,
          );
          selectedUnits = resolvedRange.units;
          rangeTruncated = resolvedRange.truncated;
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
      const base = {
        studentId,
        studentName: student?.displayName ?? "확인할 수 없는 학생",
        datasetId: progress?.recommendedDatasetId ?? null,
        datasetLabel: dataset
          ? cataloguedDatasetDisplayLabel(dataset)
          : null,
        unitId: selectedUnits[0]?.id ?? null,
        unitLabel: unitRangeLabel(selectedUnits),
        unitIds: selectedUnits.map((unit) => unit.id),
        unitLabels: selectedUnits.map((unit) => unit.label),
        rangeTruncated,
      };

      if (!student || student.status !== "active") {
        return {
          ...base,
          available: false,
          questionCount: 0,
          wrongCount: 0,
          error: "접속 가능한 학생이 아닙니다.",
        };
      }
      if (blockedReason) {
        return {
          ...base,
          available: false,
          questionCount: 0,
          wrongCount: 0,
          error: blockedReason,
        };
      }
      if (
        !progress?.recommendedDatasetId ||
        selectedUnits.length < 1 ||
        !dataset ||
        dataset.status !== "ready" ||
        !dataset.isActive
      ) {
        return {
          ...base,
          available: false,
          questionCount: 0,
          wrongCount: 0,
          error: "사용할 단어장이나 다음 범위를 정해야 합니다.",
        };
      }

      try {
        const capacity = await calculateAssignmentCapacity(
          {
            studentId,
            datasetId: progress.recommendedDatasetId,
            primaryUnitIds: selectedUnits.map((unit) => unit.id),
            includePendingReview: input.includePendingReview,
            reviewLevels: input.reviewLevels,
            englishToKoreanRatio: input.englishToKoreanRatio,
          },
          admin,
        );
        const error =
          input.includePendingReview && capacity.wrongEligible < 1
            ? "다음 시험에 추가할 틀렸던 단어가 없습니다."
            : capacity.maximumQuestionCount < capacity.minimumQuestionCount
              ? "현재 범위에서 만들 수 있는 문항이 부족합니다."
              : null;
        return {
          ...base,
          available: error === null,
          questionCount: error
            ? 0
            : capacity.recommendedQuestionCount,
          wrongCount: capacity.wrongEligible,
          error,
        };
      } catch (error) {
        return {
          ...base,
          available: false,
          questionCount: 0,
          wrongCount: 0,
          error:
            error instanceof Error
              ? error.message
              : "배정 가능 범위를 계산하지 못했습니다.",
        };
      }
    }),
  );

  return {
    items,
    assignableCount: items.filter((item) => item.available).length,
    blockedCount: items.filter((item) => !item.available).length,
  };
}

export async function createBulkAssignments(
  input: BulkAssignmentInput,
) {
  const admin = await requireAdmin();
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= Date.now()
  ) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "응시 시작 마감은 현재보다 뒤로 정해 주세요.",
    );
  }

  const preview = await previewBulkAssignments(input, admin);
  const blocked = preview.items.filter((item) => !item.available);
  if (blocked.length > 0) {
    throw new BulkAssignmentError(
      "invalid_selection",
      `${blocked[0]?.studentName ?? "학생"}: ${blocked[0]?.error ?? "배정 조건을 확인해 주세요."}`,
    );
  }

  let batches: Record<string, unknown>[];
  try {
    batches = await Promise.all(
      preview.items.map(async (item) => {
        if (
          !item.datasetId ||
          item.unitIds.length < 1 ||
          item.questionCount < 1
        ) {
          throw new BulkAssignmentError("invalid_selection");
        }
        if (input.includePendingReview) {
          const prepared = await prepareMixedAssignmentBatch(
            {
              studentId: item.studentId,
              datasetId: item.datasetId,
              primaryUnitIds: item.unitIds,
              reviewLevels: input.reviewLevels,
              englishToKoreanRatio: input.englishToKoreanRatio,
              totalQuestionCount: item.questionCount,
              title: "",
              timeLimitSeconds: input.timeLimitSeconds,
              passingScore: input.passingScore,
              questionOrderMode: input.questionOrderMode,
              availableUntil: input.availableUntil,
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
            question_count: item.questionCount,
            time_limit_seconds: prepared.timeLimitSeconds,
            passing_score: prepared.passingScore,
            question_order_mode: prepared.questionOrderMode,
            available_until: prepared.availableUntil,
            timing_mode: prepared.timingMode,
            question_time_limit_seconds:
              prepared.questionTimeLimitSeconds,
            questions: prepared.questions,
          };
        }

        const prepared = await prepareRegularAssignment(
          {
            title: "",
            datasetId: item.datasetId,
            unitIds: item.unitIds,
            questionCount: item.questionCount,
            englishToKoreanRatio: input.englishToKoreanRatio,
            timeLimitSeconds: input.timeLimitSeconds,
            timingMode: input.timingMode,
            questionTimeLimitSeconds:
              input.questionTimeLimitSeconds,
            passingScore: input.passingScore,
            questionOrderMode: input.questionOrderMode,
            availableUntil: input.availableUntil,
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
          available_until: prepared.availableUntil,
          timing_mode: prepared.timingMode,
          question_time_limit_seconds:
            prepared.questionTimeLimitSeconds,
          questions: prepared.questions,
        };
      }),
    );
  } catch (error) {
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

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "create_bulk_vocab_assignments_v4",
    { p_batches: batches },
  );
  if (error) {
    console.error("[bulk-assignment] database operation failed", {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
    });
    throw bulkDatabaseError(error);
  }

  const result = z
    .array(
      z.object({
        student_id: z.uuid(),
        assignment_id: z.uuid(),
      }),
    )
    .safeParse(data);
  if (!result.success || result.data.length !== batches.length) {
    throw new BulkAssignmentError("database");
  }
  return result.data;
}
