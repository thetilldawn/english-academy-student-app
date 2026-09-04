import "server-only";

import { MAXIMUM_BULK_ASSIGNMENT_COUNT } from "@/features/assignments/domain/model";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { BulkAssignmentInput } from "../../contracts/bulk-assignment-request";
import {
  bulkAssignmentResultSchema,
  type BulkAssignmentResult,
} from "../../contracts/bulk-assignment-response";
import type { PlannedVocabSeriesTarget } from "../../domain/vocab-assignment-contract";
import {
  bulkAssignmentRequestSha256,
  bulkAssignmentResultHasValidShape,
  bulkAssignmentResultMatchesBatches,
  lookupBulkAssignmentPersistence,
  persistBulkAssignment,
  usesCompletionQueue,
} from "../persistence/bulk-assignment-persistence";
import {
  buildVocabAssignmentQueueSeriesPayload,
  VocabAssignmentQueuePlanError,
} from "../planning/vocab-assignment-queue-plan";
import {
  type ResolvedBulkAssignmentPreview,
  resolveBulkAssignmentPreview,
} from "./bulk-assignment-preview";
import {
  BulkAssignmentError,
  bulkDatabaseError,
  mapBulkAssignmentPreparationFailure,
} from "./bulk-assignment-errors";
import { MAXIMUM_BULK_QUESTION_COUNT } from "./bulk-assignment-limits";
import {
  createBulkAssignmentPreparationContext,
  mapInBatches,
  prepareCommonPlanSeries,
} from "./bulk-assignment-series-preparation";

async function lookupBulkAssignmentResult(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  input: BulkAssignmentInput,
  requestSha256: string,
) {
  const lookup = await lookupBulkAssignmentPersistence({
    client: supabase,
    assignment: input,
    requestSha256,
  });
  if (lookup.error) throw bulkDatabaseError(lookup.error);
  if (lookup.data === null) return null;
  const previous = bulkAssignmentResultSchema.safeParse(lookup.data);
  if (!previous.success) throw new BulkAssignmentError("database");
  if (
    !bulkAssignmentResultHasValidShape(
      previous.data,
      usesCompletionQueue(input),
    )
  ) {
    throw new BulkAssignmentError("database");
  }
  return previous.data;
}

function samePlannedTargets(
  actual: readonly (readonly PlannedVocabSeriesTarget[])[],
  expected: readonly (readonly PlannedVocabSeriesTarget[])[] | undefined,
) {
  return Boolean(expected) &&
    actual.length === expected?.length &&
    actual.every((targets, sessionIndex) => {
      const expectedTargets = expected?.[sessionIndex];
      return Boolean(expectedTargets) &&
        targets.length === expectedTargets?.length &&
        targets.every((target, targetIndex) => {
          const expectedTarget = expectedTargets?.[targetIndex];
          return Boolean(expectedTarget) &&
            target.id === expectedTarget?.id &&
            target.direction === expectedTarget?.direction;
        });
    });
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

  const requestedDeadlines = input.commonPlan.sessions.map(
    (session) => session.availableUntil,
  );
  if (requestedDeadlines.some(
    (deadline) => deadline && Date.parse(deadline) <= Date.now(),
  )) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "첫 시험 마감은 현재보다 뒤로 정해 주세요.",
    );
  }

  const preparationContext = createBulkAssignmentPreparationContext();
  let resolvedPreview: ResolvedBulkAssignmentPreview;
  try {
    resolvedPreview = await resolveBulkAssignmentPreview(
      input,
      admin,
      preparationContext,
    );
  } catch (error) {
    const concurrent = await lookupBulkAssignmentResult(
      supabase,
      input,
      requestSha256,
    );
    if (concurrent) return concurrent;
    throw error;
  }
  const preview = resolvedPreview.preview;
  if (preview.planSignature !== input.previewPlanSignature) {
    throw new BulkAssignmentError(
      "conflict",
      "미리보기 뒤 출제 대상이나 일정이 바뀌었습니다. 다시 확인해 주세요.",
    );
  }
  const extraDateDecision = preview.items.find(
    (item) => item.requiresExtraDateDecision,
  );
  if (extraDateDecision) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "기본 회차보다 날짜가 많습니다. 범위 반복 여부를 선택해 주세요.",
    );
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
    if (input.questionMode !== "book_meaning_choice") {
      const canonicalPlans = resolvedPreview.canonicalPlansByStudent;
      if (!canonicalPlans) {
        throw new BulkAssignmentError("invalid_selection");
      }
      batches = preview.items.map((item) => {
        const session = item.sessions[0];
        const questionTargets = canonicalPlans.get(item.studentId) ?? [];
        const firstTarget = questionTargets[0];
        if (
          !item.available ||
          !item.datasetId ||
          !session ||
          session.sessionNumber !== 1 ||
          questionTargets.length !== session.questionCount ||
          !firstTarget ||
          questionTargets.some((target) =>
            target.releaseId !== firstTarget.releaseId ||
            target.packageSha256 !== firstTarget.packageSha256
          )
        ) {
          throw new BulkAssignmentError("invalid_selection");
        }
        const modeLabel = input.questionMode ===
            "canonical_definition_to_headword"
          ? "영영풀이"
          : "예문";
        const baseTitle = [item.datasetLabel, preview.rangeLabel, modeLabel]
          .filter(Boolean)
          .join(" · ");
        return {
          kind: "canonical_preview",
          student_id: item.studentId,
          dataset_id: item.datasetId,
          unit_ids: session.unitIds,
          unit_labels: session.unitLabels,
          title: baseTitle.slice(0, 160),
          question_count: questionTargets.length,
          quiz_content_mode: input.questionMode,
          canonical_release_id: firstTarget.releaseId,
          canonical_package_sha256: firstTarget.packageSha256,
          time_limit_seconds: input.timeLimitSeconds,
          passing_score: input.passingScore,
          retry_enabled: input.retryEnabled,
          retry_passing_score: input.retryPassingScore,
          question_order_mode: input.questionOrderMode,
          available_from: null,
          available_until: null,
          timing_mode: input.timingMode,
          question_time_limit_seconds: input.questionTimeLimitSeconds,
          session_number: 1,
          session_count: 1,
          question_targets: questionTargets.map((target, index) => ({
            vocab_entry_id: target.id,
            base_order_index: index + 1,
            question_item_id: target.questionItemId,
            question_item_sha256: target.questionItemSha256,
          })),
        };
      });
    } else {
    const regularPreparationCache = preparationContext.regular;
    const commonPlan = input.commonPlan;
    const commonBatches = await mapInBatches(
      preview.items.filter((item) => item.sessions.length > 0),
      5,
      async (item) => {
        const datasetId = item.datasetId;
        if (
          !datasetId ||
          item.availableQuestionCount === null ||
          item.sessions.length === 0
        ) {
          throw new BulkAssignmentError("invalid_selection");
        }
        const preparation = await prepareCommonPlanSeries({
          request: input,
          commonPlan,
          studentId: item.studentId,
          datasetId,
          availableQuestionCount: item.availableQuestionCount,
          maximumSessionQuestionCount: Math.max(
            ...item.sessions.map((session) => session.questionCount),
          ),
          sessions: item.sessions,
          admin,
          cache: regularPreparationCache,
          materializeQuestions: true,
        });
        if (
          preparation.sessionQuestionCounts.some(
            (count, index) => count !== item.sessions[index]?.questionCount,
          ) ||
          !samePlannedTargets(
            preparation.sessionTargets,
            resolvedPreview.targetPlansByStudent.get(item.studentId),
          )
        ) {
          throw new BulkAssignmentError(
            "conflict",
            "미리보기 뒤 출제 구성이 바뀌었습니다. 다시 확인해 주세요.",
          );
        }
        return preparation.preparedSeries.map((prepared, index) => {
          const session = item.sessions[index];
          if (!session) throw new BulkAssignmentError("invalid_selection");
          return {
            kind: "regular",
            student_id: item.studentId,
            dataset_id: prepared.datasetId,
            unit_ids: prepared.unitIds,
            unit_labels: session.unitLabels,
            title: prepared.title,
            question_count: prepared.questionCount,
            english_to_korean_ratio: prepared.englishToKoreanRatio,
            time_limit_seconds: prepared.timeLimitSeconds,
            passing_score: prepared.passingScore,
            retry_enabled: prepared.retryEnabled,
            retry_passing_score: prepared.retryPassingScore,
            question_order_mode: prepared.questionOrderMode,
            available_from: session.availableFrom,
            available_until: prepared.availableUntil,
            timing_mode: prepared.timingMode,
            question_time_limit_seconds: prepared.questionTimeLimitSeconds,
            session_number: session.sessionNumber,
            session_count: item.sessions.length,
            questions: prepared.questions,
          };
        });
      },
    );
    batches = commonBatches.flat();
    }
  } catch (error) {
    const concurrent = await lookupBulkAssignmentResult(
      supabase,
      input,
      requestSha256,
    );
    if (concurrent) return concurrent;
    throw mapBulkAssignmentPreparationFailure(error);
  }

  const totalBatchQuestionCount = batches.reduce((total, batch) => {
    const questionCount = batch.question_count;
    const questions = input.questionMode === "book_meaning_choice"
      ? batch.questions
      : batch.question_targets;
    if (
      typeof questionCount !== "number" ||
      !Number.isInteger(questionCount) ||
      questionCount < 1 ||
      !Array.isArray(questions) ||
      questions.length !== questionCount
    ) {
      throw new BulkAssignmentError("invalid_selection");
    }
    return total + questionCount;
  }, 0);
  if (
    batches.length < 1 ||
    batches.length > MAXIMUM_BULK_ASSIGNMENT_COUNT ||
    totalBatchQuestionCount > MAXIMUM_BULK_QUESTION_COUNT
  ) {
    throw new BulkAssignmentError(
      "invalid_selection",
      batches.length < 1
        ? "배정할 시험이 없습니다. 범위와 일정을 확인해 주세요."
        : batches.length > MAXIMUM_BULK_ASSIGNMENT_COUNT
          ? `한 번에 저장할 수 있는 시험은 전체 ${MAXIMUM_BULK_ASSIGNMENT_COUNT}개까지입니다.`
          : `한 번에 저장할 수 있는 시험 문제는 전체 ${MAXIMUM_BULK_QUESTION_COUNT.toLocaleString("ko-KR")}개까지입니다.`,
    );
  }

  const completionQueue = usesCompletionQueue(input);
  let queueSeries: Record<string, unknown>[] | null = null;
  if (completionQueue) {
    const commonPlan = input.commonPlan;
    try {
      queueSeries = buildVocabAssignmentQueueSeriesPayload({
        commonPlan,
        previewPlanSignature: input.previewPlanSignature,
        rangeLabel: preview.rangeLabel,
        previewItems: preview.items.map((item) => ({
          studentId: item.studentId,
          datasetId: item.datasetId,
          datasetLabel: item.datasetLabel,
          sessionCount: item.sessions.length,
        })),
        batches,
      });
    } catch (error) {
      if (error instanceof VocabAssignmentQueuePlanError) {
        throw new BulkAssignmentError("invalid_selection", error.message);
      }
      throw error;
    }
  }
  const { data, error } = await persistBulkAssignment({
    client: supabase,
    assignment: input,
    requestSha256,
    batches,
    queueSeries,
  });
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
  if (
    !result.success ||
    result.data.length !== batches.length ||
    !bulkAssignmentResultMatchesBatches(result.data, batches, completionQueue)
  ) {
    throw new BulkAssignmentError("database");
  }
  return result.data;
}
