import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  MAXIMUM_BULK_ASSIGNMENT_COUNT,
  resolveBulkAssignmentSeries,
  unitRangeLabel,
} from "@/lib/admin/bulk-assignment-range";
import { resolveBulkAssignmentSchedule } from "@/lib/admin/bulk-assignment-schedule";
import {
  enforceIncreasingResolvedSchedules,
  resolveBulkScheduleCollision,
  type BulkScheduleCollisionWarning,
} from "@/lib/admin/bulk-assignment-conflicts";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import {
  isAssignmentPersistenceInvariantFailure,
} from "@/lib/admin/assignment-database-error";
import { buildStudentProgress } from "@/lib/admin/progress";
import { resolveOrderedContiguousUnits } from "@/lib/admin/unit-range";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  createRegularAssignmentPreparationCache,
  loadRegularAssignmentSeriesCandidates,
  listAssignmentHistoryBundle,
  listDatasets,
  listStudents,
  listVocabUnits,
  prepareRegularAssignment,
  type PreparedRegularAssignment,
  type RegularAssignmentPreparationCache,
} from "@/lib/services/admin-service";
import {
  calculateAssignmentCapacity,
  calculateAssignmentSeriesCapacity,
  createMixedAssignmentPreparationCache,
  MixedAssignmentError,
  prepareMixedAssignmentBatch,
} from "@/lib/services/mixed-assignment-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  BulkAssignmentInput,
  BulkAssignmentPreviewInput,
} from "@/lib/validation";
import {
  extendScheduleSlotsFromRecurrence,
  planDirectionalVocabSeriesTargets,
  rebalanceHalfRatioSplitQuestionCounts,
  resolveVocabQuestionCycleAllocation,
  type VocabQuestionAllocationIssue,
} from "@/features/assignments/domain/vocab-assignment-plan";
import { bulkPlanSignature } from "@/features/assignments/domain/bulk-plan-signature";

export type BulkAssignmentPreviewSession = {
  sessionNumber: number;
  sourceSessionNumber: number;
  cycleIndex: number;
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
  warnings: BulkScheduleCollisionWarning[];
  error: string | null;
  errorFieldKey?: BulkAssignmentPreviewFieldKey;
};

export type BulkAssignmentPreviewFieldKey =
  | "dataset"
  | "students"
  | "preview"
  | "range"
  | "questionCount"
  | "overflowPolicy"
  | "weekdays";

export type BulkAssignmentPreviewItem = {
  studentId: string;
  studentName: string;
  available: boolean;
  datasetId: string | null;
  datasetLabel: string | null;
  sessions: BulkAssignmentPreviewSession[];
  availableQuestionCount: number | null;
  selectedQuestionCount: number | null;
  remainingQuestionCount: number | null;
  defaultSessionCount: number | null;
  scheduledQuestionCount: number | null;
  requiresExtraDateDecision: boolean;
  error: string | null;
  errorFieldKey?: BulkAssignmentPreviewFieldKey;
};

export type BulkAssignmentCommonPlanSummary = {
  representativeStudentId: string;
  normalStudentIds: string[];
  exceptionStudentIds: string[];
  availableQuestionCount: number;
  selectedQuestionCount: number;
  remainingQuestionCount: number;
  defaultSessionCount: number;
  scheduledQuestionCount: number;
  requiresExtraDateDecision: boolean;
  sessions: Array<{
    sessionNumber: number;
    availableFrom: string;
    availableUntil: string | null;
    questionCount: number;
    cycleIndex: number;
    unitLabel: string | null;
  }>;
};

export type BulkAssignmentPreview = {
  items: BulkAssignmentPreviewItem[];
  assignableCount: number;
  blockedCount: number;
  assignmentCount: number;
  commonPlanSummary: BulkAssignmentCommonPlanSummary | null;
};

const bulkAssignmentResultSchema = z.array(
  z.object({
    student_id: z.uuid(),
    assignment_id: z.uuid().nullable(),
    queue_series_id: z.uuid().nullable().optional().default(null),
    queue_item_id: z.uuid().nullable().optional().default(null),
    session_number: z.coerce.number().int().positive(),
    status: z
      .enum(["assigned", "queued"])
      .optional()
      .default("assigned"),
  }),
);

export type BulkAssignmentResult = z.infer<
  typeof bulkAssignmentResultSchema
>[number];

const MAXIMUM_BULK_QUESTION_COUNT = 10_000;
const SEOUL_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;
const MAXIMUM_QUEUE_WINDOW_SECONDS = 365 * 24 * 60 * 60;

function usesCompletionQueue(input: BulkAssignmentInput) {
  return input.commonPlan?.distribution === "split";
}

function toSeoulRecurrenceSlot(input: {
  availableFrom: string;
  availableUntil: string;
}) {
  const from = Date.parse(input.availableFrom);
  const until = Date.parse(input.availableUntil);
  const durationSeconds = Math.floor((until - from) / 1000);
  if (durationSeconds < 60 || durationSeconds > MAXIMUM_QUEUE_WINDOW_SECONDS) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "이어 배정의 공개·마감 간격은 1분부터 365일까지 설정할 수 있습니다.",
    );
  }
  const local = new Date(from + SEOUL_OFFSET_MILLISECONDS);
  const day = local.getUTCDay();
  return {
    isodow: day === 0 ? 7 : day,
    local_time: [
      local.getUTCHours(),
      local.getUTCMinutes(),
      local.getUTCSeconds(),
    ]
      .map((part) => String(part).padStart(2, "0"))
      .join(":"),
    duration_seconds: durationSeconds,
  };
}

function queueRangeLabel(sessions: readonly BulkAssignmentPreviewSession[]) {
  const labels = sessions.flatMap((session) => session.unitLabels);
  const unique = [...new Set(labels)];
  if (unique.length === 0) return "선택 범위";
  if (unique.length === 1) return unique[0]!;
  return `${unique[0]}~${unique.at(-1)}`;
}

async function mapInBatches<Input, Output>(
  items: readonly Input[],
  batchSize: number,
  mapper: (item: Input) => Promise<Output>,
) {
  const results: Output[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(
      ...await Promise.all(items.slice(index, index + batchSize).map(mapper)),
    );
  }
  return results;
}

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
  if (isAssignmentPersistenceInvariantFailure(error)) {
    return new BulkAssignmentError("database");
  }
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
    ["22023", "23503"].includes(error.code ?? "")
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
  return `${sessionNumber}회차에 배정할 다음 범위가 없습니다. 시험 횟수나 회차당 범위를 줄여 주세요.`;
}

function commonPlanSchedule(input: BulkAssignmentPreviewInput) {
  if (!input.commonPlan) return resolveBulkAssignmentSchedule(input);
  return input.commonPlan.sessions.map((session, index) => ({
    sessionNumber: index + 1,
    availableFrom: session.availableFrom,
    availableUntil: session.availableUntil,
  }));
}

function allocationIssueMessage(issue: VocabQuestionAllocationIssue) {
  if (issue === "invalid_available_count") {
    return "현재 범위에서 만들 수 있는 문항이 4개보다 적습니다.";
  }
  if (issue === "invalid_question_count") {
    return "문항 수는 4개부터 500개까지 입력해 주세요.";
  }
  if (issue === "missing_schedule") {
    return "배정할 요일을 하나 이상 선택해 주세요.";
  }
  if (issue === "insufficient_for_selected_dates") {
    return "선택한 모든 날짜에 최소 4문항씩 배정할 수 없습니다. 날짜를 줄이거나 범위를 넓혀 주세요.";
  }
  if (issue === "question_count_exceeds_capacity") {
    return "직접 입력한 문항 수가 현재 출제 가능한 문항 수보다 많습니다.";
  }
  if (issue === "session_question_limit_exceeded") {
    return "한 회차에는 최대 500문항까지 배정할 수 있습니다. 날짜를 늘리거나 문항 수를 직접 입력해 주세요.";
  }
  return "한 번에 저장할 수 있는 시험 수를 넘었습니다. 학생 수나 문항 범위를 나눠서 배정해 주세요.";
}

function allocationIssueFieldKey(
  issue: VocabQuestionAllocationIssue,
): BulkAssignmentPreviewFieldKey {
  if (issue === "missing_schedule") return "weekdays";
  if (issue === "series_session_limit_exceeded") return "overflowPolicy";
  if (
    issue === "invalid_available_count" ||
    issue === "insufficient_for_selected_dates"
  ) {
    return "range";
  }
  return "questionCount";
}

function extendCommonPlanSchedule(
  schedule: ReturnType<typeof commonPlanSchedule>,
  recurrenceSchedule: CommonPlanInput["recurrenceSessions"],
  requiredSessionCount: number,
) {
  const baseSchedule = schedule.map((slot) => ({
    sessionNumber: slot.sessionNumber,
    date: slot.availableFrom.slice(0, 10),
    availableLocalDateTime: slot.availableFrom,
    deadlineLocalDateTime: slot.availableUntil ?? slot.availableFrom,
  }));
  const recurrenceBase = recurrenceSchedule.map((slot, index) => ({
    sessionNumber: index + 1,
    date: slot.availableFrom.slice(0, 10),
    availableLocalDateTime: slot.availableFrom,
    deadlineLocalDateTime: slot.availableUntil,
  }));
  const extended = extendScheduleSlotsFromRecurrence(
    baseSchedule,
    recurrenceBase,
    requiredSessionCount,
  );
  return extended.map((slot) => ({
    sessionNumber: slot.sessionNumber,
    availableFrom: slot.availableLocalDateTime,
    availableUntil: slot.deadlineLocalDateTime,
  }));
}

function buildCommonPlanSummary(
  items: readonly BulkAssignmentPreviewItem[],
): BulkAssignmentCommonPlanSummary | null {
  const groups = new Map<string, BulkAssignmentPreviewItem[]>();
  for (const item of items) {
    if (
      !item.available ||
      item.error ||
      item.availableQuestionCount === null ||
      item.selectedQuestionCount === null ||
      item.remainingQuestionCount === null ||
      item.defaultSessionCount === null ||
      item.scheduledQuestionCount === null ||
      item.sessions.length === 0 ||
      item.sessions.some(
        (session) =>
          !session.available ||
          Boolean(session.error) ||
          session.warnings.length > 0,
      )
    ) {
      continue;
    }
    const signature = bulkPlanSignature(item);
    const group = groups.get(signature) ?? [];
    group.push(item);
    groups.set(signature, group);
  }
  const selectedGroup = [...groups.values()].toSorted(
    (left, right) => right.length - left.length,
  )[0];
  const representative = selectedGroup?.[0];
  if (
    !selectedGroup ||
    selectedGroup.length < 2 ||
    !representative ||
    representative.availableQuestionCount === null ||
    representative.selectedQuestionCount === null ||
    representative.remainingQuestionCount === null
    || representative.defaultSessionCount === null
    || representative.scheduledQuestionCount === null
  ) {
    return null;
  }
  const normalStudentIds = selectedGroup.map((item) => item.studentId);
  const normalStudentIdSet = new Set(normalStudentIds);
  return {
    representativeStudentId: representative.studentId,
    normalStudentIds,
    exceptionStudentIds: items
      .filter((item) => !normalStudentIdSet.has(item.studentId))
      .map((item) => item.studentId),
    availableQuestionCount: representative.availableQuestionCount,
    selectedQuestionCount: representative.selectedQuestionCount,
    remainingQuestionCount: representative.remainingQuestionCount,
    defaultSessionCount: representative.defaultSessionCount,
    scheduledQuestionCount: representative.scheduledQuestionCount,
    requiresExtraDateDecision:
      representative.requiresExtraDateDecision,
    sessions: representative.sessions.map((session) => ({
      sessionNumber: session.sessionNumber,
      availableFrom: session.availableFrom,
      availableUntil: session.availableUntil,
      questionCount: session.questionCount,
      cycleIndex: session.cycleIndex,
      unitLabel: session.unitLabel,
    })),
  };
}

type CommonPlanInput = NonNullable<
  BulkAssignmentPreviewInput["commonPlan"]
>;

function includesAssignmentSettings(
  request: BulkAssignmentPreviewInput,
): request is BulkAssignmentInput {
  return "passingScore" in request;
}

async function prepareCommonPlanSeries(input: {
  request: BulkAssignmentPreviewInput;
  commonPlan: CommonPlanInput;
  studentId: string;
  datasetId: string;
  availableQuestionCount: number;
  sessions: readonly BulkAssignmentPreviewSession[];
  admin: AdminContext;
  cache: RegularAssignmentPreparationCache;
  materializeQuestions: boolean;
}): Promise<{
  preparedSeries: PreparedRegularAssignment[];
  sessionQuestionCounts: number[];
}> {
  const {
    request,
    commonPlan,
    studentId,
    datasetId,
    availableQuestionCount,
    sessions,
    admin,
    cache,
    materializeQuestions,
  } = input;
  const assignmentSettings = includesAssignmentSettings(request)
    ? {
        timeLimitSeconds: request.timeLimitSeconds,
        timingMode: request.timingMode,
        questionTimeLimitSeconds: request.questionTimeLimitSeconds,
        passingScore: request.passingScore,
        questionOrderMode: request.questionOrderMode,
      }
    : {
        timeLimitSeconds: 900,
        timingMode: "total" as const,
        questionTimeLimitSeconds: null,
        passingScore: 80,
        questionOrderMode: "ascending" as const,
      };
  const firstSession = sessions[0];
  if (
    availableQuestionCount < 1 ||
    !firstSession ||
    sessions.some(
      (session) => session.unitIds.length < 1 || session.questionCount < 1,
    )
  ) {
    throw new BulkAssignmentError("invalid_selection");
  }
  const targetEligibility = await loadRegularAssignmentSeriesCandidates(
    {
      datasetId,
      unitIds: firstSession.unitIds,
      studentIds: [studentId],
    },
    admin,
    cache,
  );
  const sessionQuestionCounts = sessions.map((session) => session.questionCount);
  const planTargetIds = (
    counts: readonly number[],
    cycleIndex: number | null,
  ) =>
    planDirectionalVocabSeriesTargets({
      candidates: targetEligibility,
      distribution: commonPlan.distribution,
      selectionMode: commonPlan.selectionMode,
      sessionQuestionCounts: counts,
      englishToKoreanRatio: request.englishToKoreanRatio,
      seedScope: cycleIndex === null
        ? `${commonPlan.planNonce}:${studentId}:series`
        : `${commonPlan.planNonce}:${studentId}:cycle:${cycleIndex}`,
    });
  const cycleGroups: Array<{ start: number; end: number; cycleIndex: number | null }> = [];
  if (commonPlan.distribution === "split") {
    let start = 0;
    while (start < sessions.length) {
      const cycleIndex = sessions[start]!.cycleIndex;
      let end = start + 1;
      while (
        end < sessions.length &&
        sessions[end]!.cycleIndex === cycleIndex
      ) {
        end += 1;
      }
      cycleGroups.push({ start, end, cycleIndex });
      start = end;
    }
  } else {
    cycleGroups.push({ start: 0, end: sessions.length, cycleIndex: null });
  }
  const plannedTargets: ReturnType<typeof planDirectionalVocabSeriesTargets> = [];
  for (const group of cycleGroups) {
    let groupCounts = sessionQuestionCounts.slice(group.start, group.end);
    let groupTargets = planTargetIds(groupCounts, group.cycleIndex);
    if (
      groupTargets.length !== groupCounts.length &&
      commonPlan.distribution === "split" &&
      request.englishToKoreanRatio === 50
    ) {
      const maximumQuestionCount = commonPlan.questionCount.mode === "manual"
        ? commonPlan.questionCount.value
        : 500;
      const adjustedCounts = rebalanceHalfRatioSplitQuestionCounts(
        groupCounts,
        maximumQuestionCount,
      );
      if (adjustedCounts) {
        const adjustedTargets = planTargetIds(
          adjustedCounts,
          group.cycleIndex,
        );
        if (adjustedTargets.length === groupCounts.length) {
          groupCounts = adjustedCounts;
          groupTargets = adjustedTargets;
        }
      }
    }
    sessionQuestionCounts.splice(
      group.start,
      group.end - group.start,
      ...groupCounts,
    );
    plannedTargets.push(...groupTargets);
  }
  if (
    plannedTargets.length !== sessions.length ||
    plannedTargets.some(
      (targets, index) =>
        targets.length !== sessionQuestionCounts[index],
    )
  ) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "전체 회차의 문항 수와 출제 방향을 함께 만들 수 없습니다.",
    );
  }

  const preparedSeries: PreparedRegularAssignment[] = [];
  if (!materializeQuestions) {
    return { preparedSeries, sessionQuestionCounts };
  }
  for (const [index, session] of sessions.entries()) {
    const exactTargets = plannedTargets[index]!;
    preparedSeries.push(await prepareRegularAssignment(
      {
        title: "",
        datasetId,
        unitIds: session.unitIds,
        questionCount: sessionQuestionCounts[index]!,
        englishToKoreanRatio: request.englishToKoreanRatio,
        ...assignmentSettings,
        availableUntil: session.availableUntil,
        studentIds: [studentId],
        targetSelectionMode: commonPlan.selectionMode,
        randomSeed:
          `${commonPlan.planNonce}:${studentId}:${session.sourceSessionNumber}`,
        exactTargetIds: exactTargets.map((target) => target.id),
        exactTargetDirections: exactTargets.map((target) => target.direction),
      },
      admin,
      undefined,
      cache,
    ));
  }
  return { preparedSeries, sessionQuestionCounts };
}

export async function previewBulkAssignments(
  input: BulkAssignmentPreviewInput,
  authenticatedAdmin?: AdminContext,
): Promise<BulkAssignmentPreview> {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  const preparationCache = createMixedAssignmentPreparationCache();
  const regularPreparationCache = createRegularAssignmentPreparationCache();
  const [students, datasets, units, historyBundle] = await Promise.all([
    listStudents(),
    listDatasets(),
    listVocabUnits(),
    listAssignmentHistoryBundle({ finalizeStale: false }),
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
    buildStudentProgress(students, units, historyBundle.completeHistory).map(
      (item) => [item.studentId, item],
    ),
  );
  const schedule = commonPlanSchedule(input);

  const items = await Promise.all(
    input.studentIds.map(async (studentId) => {
      const student = studentById.get(studentId);
      const progress = progressByStudent.get(studentId);
      const progressBlockedReason = !input.commonPlan && progress
        ? unavailableReason(progress.recommendationReason)
        : null;
      const selectedDatasetId = input.commonPlan?.datasetId ??
        progress?.recommendedDatasetId ?? null;
      const dataset = selectedDatasetId
        ? datasetById.get(selectedDatasetId)
        : null;
      let rangeError: string | null = null;
      let resolvedSessions: Array<{
        sessionNumber: number;
        units: (typeof units)[number][];
        truncated: boolean;
      }> = [];
      if (input.commonPlan && dataset) {
        try {
          const datasetUnits = unitsByDataset.get(dataset.id) ?? [];
          resolvedSessions = input.commonPlan.sessions.map((session, index) => ({
            sessionNumber: index + 1,
            units: resolveOrderedContiguousUnits(datasetUnits, session.unitIds),
            truncated: false,
          }));
        } catch {
          rangeError = "선택한 공통 범위를 사용할 수 없습니다.";
        }
      } else if (
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
          rangeError = "학생의 다음 범위를 자동으로 확인할 수 없습니다.";
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
        datasetId: selectedDatasetId,
        datasetLabel: dataset
          ? cataloguedDatasetDisplayLabel(dataset)
          : null,
        defaultSessionCount: null,
        scheduledQuestionCount: null,
        requiresExtraDateDecision: false,
      };

      if (!student || student.status !== "active") {
        return {
          ...itemBase,
          available: false,
          sessions: [],
          availableQuestionCount: null,
          selectedQuestionCount: null,
          remainingQuestionCount: null,
          error: "접속 가능한 학생이 아닙니다.",
          errorFieldKey: "students" as const,
        };
      }
      if (blockedReason) {
        return {
          ...itemBase,
          available: false,
          sessions: [],
          availableQuestionCount: null,
          selectedQuestionCount: null,
          remainingQuestionCount: null,
          error: blockedReason,
          errorFieldKey: rangeError ? "range" as const : "dataset" as const,
        };
      }
      if (
        !selectedDatasetId ||
        resolvedSessions.length !== input.sessionCount ||
        !dataset ||
        dataset.status !== "ready" ||
        !dataset.isActive
      ) {
        return {
          ...itemBase,
          available: false,
          sessions: [],
          availableQuestionCount: null,
          selectedQuestionCount: null,
          remainingQuestionCount: null,
          error: "사용할 단어장이나 다음 범위를 정해야 합니다.",
          errorFieldKey: "dataset" as const,
        };
      }

      let itemSchedule = schedule;
      let availableQuestionCount: number | null = null;
      let selectedQuestionCount: number | null = null;
      let remainingQuestionCount: number | null = null;
      let defaultSessionCount: number | null = null;
      let scheduledQuestionCount: number | null = null;
      let requiresExtraDateDecision = false;
      const plannedQuestionCountBySession = new Map<number, number>();
      const cycleIndexBySession = new Map<number, number>();
      if (input.commonPlan) {
        const commonUnits = resolvedSessions[0]?.units ?? [];
        try {
          const capacity = await calculateAssignmentSeriesCapacity(
            {
              studentId,
              datasetId: dataset.id,
              primaryUnitIds: commonUnits.map((unit) => unit.id),
              includePendingReview: false,
              reviewLevels: input.reviewLevels,
              englishToKoreanRatio: input.englishToKoreanRatio,
            },
            admin,
            undefined,
            preparationCache,
          );
          availableQuestionCount = capacity.seriesMaximumQuestionCount;
          const allocation = resolveVocabQuestionCycleAllocation({
            availableQuestionCount,
            distribution: input.commonPlan.distribution,
            questionCount: input.commonPlan.questionCount,
            selectedDateCount: input.commonPlan.selectedDateCount,
            extraDatePolicy: input.commonPlan.extraDatePolicy,
            maximumSessionCount: MAXIMUM_BULK_ASSIGNMENT_COUNT,
          });
          if (allocation.issue) {
            return {
              ...itemBase,
              available: false,
              sessions: [],
              availableQuestionCount,
              selectedQuestionCount: null,
              remainingQuestionCount: null,
              error: allocationIssueMessage(allocation.issue),
              errorFieldKey: allocationIssueFieldKey(allocation.issue),
            };
          }
          selectedQuestionCount = allocation.selectedQuestionCount;
          remainingQuestionCount = allocation.remainingQuestionCount;
          defaultSessionCount = allocation.defaultSessionCount;
          scheduledQuestionCount = allocation.scheduledQuestionCount;
          requiresExtraDateDecision =
            allocation.requiresExtraDateDecision;
          itemSchedule = extendCommonPlanSchedule(
            schedule,
            input.commonPlan.recurrenceSessions,
            allocation.sessionQuestionCounts.length,
          );
          resolvedSessions = allocation.sessionQuestionCounts.map(
            (questionCount, index) => {
              plannedQuestionCountBySession.set(index + 1, questionCount);
              cycleIndexBySession.set(
                index + 1,
                allocation.sessionCycleIndexes[index] ?? 0,
              );
              return {
                sessionNumber: index + 1,
                units: commonUnits,
                truncated: false,
              };
            },
          );
        } catch (error) {
          return {
            ...itemBase,
            available: false,
            sessions: [],
            availableQuestionCount,
            selectedQuestionCount: null,
            remainingQuestionCount: null,
            error: error instanceof Error
              ? error.message
              : "배정 가능 범위를 계산하지 못했습니다.",
            errorFieldKey: "preview" as const,
          };
        }
      }

      const sessions: BulkAssignmentPreviewSession[] = [];
      for (const [index, resolved] of resolvedSessions.entries()) {
        const previewSession = await (async () => {
          const scheduled = itemSchedule[index];
          if (!scheduled) return null;
          const collisionResolution = input.commonPlan
            ? resolveBulkScheduleCollision({
                studentId,
                sourceSessionNumber: resolved.sessionNumber,
                schedule: scheduled,
                existingAssignments: historyBundle.completeHistory
                  .filter(
                    (item) =>
                      item.studentId === studentId &&
                      !item.assignmentDeleted &&
                      ["not_started", "in_progress"].includes(item.status) &&
                      Boolean(item.availableFrom ?? item.assignedAt),
                  )
                  .map((item) => ({
                    assignmentId: item.assignmentId,
                    assignmentTitle:
                      item.assignmentTitle.trim() || item.datasetTitle,
                    availableFrom: item.availableFrom ?? item.assignedAt,
                  })),
                decisions: input.commonPlan.collisionDecisions,
              })
            : {
                kind: "scheduled" as const,
                schedule: scheduled,
                warnings: [],
                unresolved: false,
              };
          if (collisionResolution.kind === "skip") return null;
          const unitIds = resolved.units.map((unit) => unit.id);
          const sessionBase = {
            sessionNumber: resolved.sessionNumber,
            sourceSessionNumber: resolved.sessionNumber,
            cycleIndex: cycleIndexBySession.get(resolved.sessionNumber) ?? 0,
            unitId: resolved.units[0]?.id ?? null,
            unitLabel: unitRangeLabel(resolved.units),
            unitIds,
            unitLabels: resolved.units.map((unit) => unit.label),
            rangeTruncated: resolved.truncated,
            availableFrom: collisionResolution.schedule.availableFrom,
            availableUntil: collisionResolution.schedule.availableUntil,
            warnings: collisionResolution.warnings,
          };
          if (unitIds.length === 0) {
            return {
              ...sessionBase,
              available: false,
              questionCount: 0,
              wrongCount: 0,
              error: emptySessionError(resolved.sessionNumber),
              errorFieldKey: "range" as const,
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
              undefined,
              preparationCache,
            );
            const plannedQuestionCount = plannedQuestionCountBySession.get(
              resolved.sessionNumber,
            );
            const capacityError =
              includeReview && capacity.wrongEligible < 1
                ? "다음 시험에 추가 가능한 틀린 단어가 없습니다."
                : includeReview &&
                    capacity.recommendedQuestionCount <= capacity.wrongEligible
                  ? "첫 회차에 새 범위 단어를 하나 이상 포함할 수 없습니다."
                : capacity.maximumQuestionCount < capacity.minimumQuestionCount
                  ? "현재 범위에서 만들 수 있는 문항이 부족합니다."
                  : plannedQuestionCount !== undefined &&
                      plannedQuestionCount > capacity.maximumQuestionCount
                    ? "현재 회차에서 만들 수 있는 문항이 부족합니다."
                  : null;
            const error = collisionResolution.unresolved
              ? "같은 날 시험 겹침의 처리 방법을 선택해 주세요."
              : capacityError;
            return {
              ...sessionBase,
              available: error === null,
              questionCount: error
                ? 0
                : plannedQuestionCount ?? capacity.recommendedQuestionCount,
              wrongCount: includeReview ? capacity.wrongEligible : 0,
              error,
              ...(capacityError && !collisionResolution.unresolved
                ? { errorFieldKey: "questionCount" as const }
                : collisionResolution.unresolved
                  ? { errorFieldKey: "preview" as const }
                  : {}),
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
              errorFieldKey: "preview" as const,
            };
          }
        })();
        if (previewSession) sessions.push(previewSession);
      }
      const normalizedSessions = sessions.map((session, index) => ({
        ...session,
        sessionNumber: index + 1,
      }));
      let orderedSessions = input.commonPlan
        ? enforceIncreasingResolvedSchedules({
            studentId,
            sessions: normalizedSessions,
            decisions: input.commonPlan.collisionDecisions,
          })
        : normalizedSessions;
      const deliberatelySkippedAll =
        Boolean(input.commonPlan) &&
        resolvedSessions.length > 0 &&
        orderedSessions.length === 0;
      const firstError = orderedSessions.find(
        (session) => !session.available,
      )?.error;
      const firstErrorFieldKey = orderedSessions.find(
        (session) => !session.available,
      )?.errorFieldKey;
      const skippedSessionCount = Math.max(
        0,
        resolvedSessions.length - normalizedSessions.length,
      );
      let seriesPreparationError: string | null = null;
      if (
        input.commonPlan &&
        dataset &&
        availableQuestionCount !== null &&
        orderedSessions.length > 0 &&
        orderedSessions.every((session) => session.available)
      ) {
        try {
          const preparation = await prepareCommonPlanSeries({
            request: input,
            commonPlan: input.commonPlan,
            studentId,
            datasetId: dataset.id,
            availableQuestionCount,
            sessions: orderedSessions,
            admin,
            cache: regularPreparationCache,
            materializeQuestions: false,
          });
          orderedSessions = orderedSessions.map((session, index) => ({
            ...session,
            questionCount:
              preparation.sessionQuestionCounts[index] ?? session.questionCount,
          }));
        } catch (error) {
          seriesPreparationError = error instanceof Error
            ? error.message
            : "회차별 출제 대상을 확정하지 못했습니다.";
        }
      }
      if (input.commonPlan && availableQuestionCount !== null) {
        scheduledQuestionCount = orderedSessions.reduce(
          (total, session) => total + session.questionCount,
          0,
        );
        selectedQuestionCount = input.commonPlan.distribution === "split"
          ? Math.min(availableQuestionCount, scheduledQuestionCount)
          : orderedSessions[0]?.questionCount ?? 0;
        remainingQuestionCount = Math.max(
          0,
          availableQuestionCount - selectedQuestionCount,
        );
      }
      return {
        ...itemBase,
        available:
          deliberatelySkippedAll ||
          (seriesPreparationError === null &&
            orderedSessions.length > 0 &&
            orderedSessions.every((session) => session.available)),
        sessions: orderedSessions,
        availableQuestionCount,
        selectedQuestionCount,
        remainingQuestionCount,
        defaultSessionCount,
        scheduledQuestionCount,
        requiresExtraDateDecision,
        error:
          firstError ??
          seriesPreparationError ??
          (deliberatelySkippedAll
            ? "모든 후보 회차를 건너뛰었습니다."
            : skippedSessionCount > 0
              ? `건너뜀으로 ${skippedSessionCount}회차 범위가 이번 배정에서 빠집니다.`
            : null),
        ...(firstErrorFieldKey || seriesPreparationError
          ? {
              errorFieldKey:
                firstErrorFieldKey ?? ("questionCount" as const),
            }
          : {}),
      };
    }),
  );

  const assignmentCount = items.reduce(
    (count, item) =>
      count + item.sessions.filter((session) => session.available).length,
    0,
  );
  const totalQuestionCount = items.reduce(
    (total, item) =>
      total + item.sessions.reduce(
        (studentTotal, session) =>
          studentTotal + (session.available ? session.questionCount : 0),
        0,
      ),
    0,
  );
  const assignmentLimitExceeded =
    assignmentCount > MAXIMUM_BULK_ASSIGNMENT_COUNT;
  const questionLimitExceeded =
    totalQuestionCount > MAXIMUM_BULK_QUESTION_COUNT;
  const boundedItems = assignmentLimitExceeded || questionLimitExceeded
    ? items.map((item) => item.sessions.length === 0
      ? item
      : {
          ...item,
          available: false,
          error: assignmentLimitExceeded
            ? `한 번에 저장할 수 있는 시험은 전체 ${MAXIMUM_BULK_ASSIGNMENT_COUNT}개까지입니다. 학생이나 회차를 줄여 주세요.`
            : `한 번에 저장할 수 있는 실제 문항은 전체 ${MAXIMUM_BULK_QUESTION_COUNT.toLocaleString("ko-KR")}개까지입니다. 학생·회차·문항 수를 줄여 주세요.`,
          errorFieldKey: "questionCount" as const,
        })
    : items;

  return {
    items: boundedItems,
    assignableCount: boundedItems.filter(
      (item) => item.available && item.sessions.length > 0,
    ).length,
    blockedCount: boundedItems.filter((item) => !item.available).length,
    assignmentCount,
    commonPlanSummary: input.commonPlan
      ? buildCommonPlanSummary(boundedItems)
      : null,
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
        commonPlan: input.commonPlan
          ? {
              ...input.commonPlan,
              collisionDecisions: [...input.commonPlan.collisionDecisions]
                .toSorted((left, right) =>
                  left.collisionId.localeCompare(right.collisionId),
                ),
            }
          : null,
      }),
      "utf8",
    )
    .digest("hex");
}

function buildCompletionQueueSeriesPayload(
  input: BulkAssignmentInput,
  preview: BulkAssignmentPreview,
  batches: readonly Record<string, unknown>[],
) {
  const commonPlan = input.commonPlan;
  if (!commonPlan || commonPlan.distribution !== "split") {
    throw new BulkAssignmentError("invalid_selection");
  }
  const batchesByStudent = new Map<string, Record<string, unknown>[]>();
  for (const batch of batches) {
    const studentId = batch.student_id;
    if (typeof studentId !== "string") {
      throw new BulkAssignmentError("invalid_selection");
    }
    const current = batchesByStudent.get(studentId) ?? [];
    current.push(batch);
    batchesByStudent.set(studentId, current);
  }

  const recurrenceSlots = commonPlan.recurrenceSessions.map(
    toSeoulRecurrenceSlot,
  );
  return preview.items
    .filter((item) => item.sessions.length > 0)
    .map((item) => {
      const items = (batchesByStudent.get(item.studentId) ?? []).toSorted(
        (left, right) =>
          Number(left.session_number) - Number(right.session_number),
      );
      if (
        !item.datasetId ||
        !item.datasetLabel ||
        items.length !== item.sessions.length
      ) {
        throw new BulkAssignmentError("invalid_selection");
      }
      return {
        student_id: item.studentId,
        dataset_id: item.datasetId,
        dataset_label: item.datasetLabel,
        range_label: queueRangeLabel(item.sessions),
        recurrence_slots: recurrenceSlots,
        items,
      };
    })
    .toSorted((left, right) => left.student_id.localeCompare(right.student_id));
}

async function lookupBulkAssignmentResult(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  input: BulkAssignmentInput,
  requestSha256: string,
) {
  const lookup = await supabase.rpc(
    usesCompletionQueue(input)
      ? "get_vocab_assignment_queue_result_v1"
      : "get_bulk_vocab_series_result_v1",
    {
    p_idempotency_key: input.idempotencyKey,
    p_request_sha256: requestSha256,
    },
  );
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

  const requestedDeadlines = input.commonPlan
    ? [
        ...input.commonPlan.sessions.map((session) => session.availableUntil),
        ...input.commonPlan.collisionDecisions.flatMap((decision) =>
          decision.mode === "move" && decision.movedAvailableUntil
            ? [decision.movedAvailableUntil]
            : [],
        ),
      ]
    : [input.firstAvailableUntil];
  if (requestedDeadlines.some(
    (deadline) => deadline && Date.parse(deadline) <= Date.now(),
  )) {
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
    const newlyColliding = blocked.find((item) =>
      item.sessions.some((session) =>
        session.warnings.some((warning) => !warning.resolved)
      )
    );
    if (newlyColliding) {
      throw new BulkAssignmentError(
        "conflict",
        "저장 직전에 새 시험 겹침이 확인되었습니다. 미리보기에서 처리 방법을 선택해 주세요.",
      );
    }
    throw new BulkAssignmentError(
      "invalid_selection",
      `${blocked[0]?.studentName ?? "학생"}: ${blocked[0]?.error ?? "배정 조건을 확인해 주세요."}`,
    );
  }

  let batches: Record<string, unknown>[];
  try {
    batches = [];
    const mixedPreparationCache =
      createMixedAssignmentPreparationCache();
    const regularPreparationCache =
      createRegularAssignmentPreparationCache();
    if (input.commonPlan) {
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
            sessions: item.sessions,
            admin,
            cache: regularPreparationCache,
            materializeQuestions: true,
          });
          if (preparation.sessionQuestionCounts.some(
            (count, index) => count !== item.sessions[index]?.questionCount,
          )) {
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
              question_order_mode: prepared.questionOrderMode,
              available_from: session.availableFrom,
              available_until: prepared.availableUntil,
              timing_mode: prepared.timingMode,
              question_time_limit_seconds: prepared.questionTimeLimitSeconds,
              allowed_collision_assignment_ids: session.warnings.flatMap(
                (warning) =>
                  warning.resolved && warning.existingAssignmentId
                    ? [warning.existingAssignmentId]
                    : [],
              ),
              session_number: session.sessionNumber,
              session_count: item.sessions.length,
              questions: prepared.questions,
            };
          });
        },
      );
      batches.push(...commonBatches.flat());
    } else {
      const sessionInputs = preview.items.flatMap((item) =>
        item.sessions.map((session) => ({ item, session })),
      );
      const itemBatches = await mapInBatches(
        sessionInputs,
        30,
        async ({ item, session }) => {
        if (
          !item.datasetId ||
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
              questionTimeLimitSeconds: input.questionTimeLimitSeconds,
            },
            admin,
            undefined,
            mixedPreparationCache,
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
            english_to_korean_ratio: prepared.englishToKoreanRatio,
            question_count: session.questionCount,
            time_limit_seconds: prepared.timeLimitSeconds,
            passing_score: prepared.passingScore,
            question_order_mode: prepared.questionOrderMode,
            available_from: session.availableFrom,
            available_until: prepared.availableUntil,
            timing_mode: prepared.timingMode,
            question_time_limit_seconds: prepared.questionTimeLimitSeconds,
            allowed_collision_assignment_ids: session.warnings.flatMap(
              (warning) =>
                warning.resolved && warning.existingAssignmentId
                  ? [warning.existingAssignmentId]
                  : [],
            ),
            session_number: session.sessionNumber,
            session_count: item.sessions.length,
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
            questionTimeLimitSeconds: input.questionTimeLimitSeconds,
            passingScore: input.passingScore,
            questionOrderMode: input.questionOrderMode,
            availableUntil: session.availableUntil,
            studentIds: [item.studentId],
          },
          admin,
          undefined,
          regularPreparationCache,
        );
        return {
          kind: "regular",
          student_id: item.studentId,
          dataset_id: prepared.datasetId,
          unit_ids: prepared.unitIds,
          title: prepared.title,
          question_count: prepared.questionCount,
          english_to_korean_ratio: prepared.englishToKoreanRatio,
          time_limit_seconds: prepared.timeLimitSeconds,
          passing_score: prepared.passingScore,
          question_order_mode: prepared.questionOrderMode,
          available_from: session.availableFrom,
          available_until: prepared.availableUntil,
          timing_mode: prepared.timingMode,
          question_time_limit_seconds: prepared.questionTimeLimitSeconds,
          allowed_collision_assignment_ids: session.warnings.flatMap(
            (warning) =>
              warning.resolved && warning.existingAssignmentId
                ? [warning.existingAssignmentId]
                : [],
          ),
          session_number: session.sessionNumber,
          session_count: item.sessions.length,
          questions: prepared.questions,
        };
        },
      );
      batches.push(...itemBatches);
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

  const totalBatchQuestionCount = batches.reduce((total, batch) => {
    const questionCount = batch.question_count;
    const questions = batch.questions;
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
        ? "배정할 시험이 없습니다. 건너뜀 선택을 확인해 주세요."
        : batches.length > MAXIMUM_BULK_ASSIGNMENT_COUNT
          ? `한 번에 저장할 수 있는 시험은 전체 ${MAXIMUM_BULK_ASSIGNMENT_COUNT}개까지입니다.`
          : `한 번에 저장할 수 있는 실제 문항은 전체 ${MAXIMUM_BULK_QUESTION_COUNT.toLocaleString("ko-KR")}개까지입니다.`,
    );
  }

  const completionQueue = usesCompletionQueue(input);
  const { data, error } = completionQueue
    ? await supabase.rpc("create_vocab_assignment_queues_v1", {
        p_idempotency_key: input.idempotencyKey,
        p_request_sha256: requestSha256,
        p_series: buildCompletionQueueSeriesPayload(input, preview, batches),
      })
    : await supabase.rpc("create_bulk_vocab_assignments_v8", {
        p_idempotency_key: input.idempotencyKey,
        p_request_sha256: requestSha256,
        p_batches: batches,
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
  if (!result.success || result.data.length !== batches.length) {
    throw new BulkAssignmentError("database");
  }
  return result.data;
}
