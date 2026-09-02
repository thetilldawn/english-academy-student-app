import "server-only";

import { MAXIMUM_BULK_ASSIGNMENT_COUNT } from "@/features/assignments/domain/model";
import { unitSelectionLabel } from "@/features/assignments/domain/unit-selection-label";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import { resolveOrderedUnitSelection } from "@/lib/admin/unit-range";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  calculateRegularAssignmentCapacity,
  primeRegularAssignmentStudentCaches,
} from "@/lib/services/regular-assignment-service";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";
import { resolvedBulkPlanSha256 } from "../planning/bulk-assignment-plan-digest";
import type { BulkAssignmentPreviewInput } from "@/features/assignments/contracts/bulk-assignment-request";
import {
  type PlannedVocabSeriesTarget,
  type VocabQuestionAllocationIssue,
} from "@/features/assignments/domain/vocab-assignment-contract";
import { resolveVocabQuestionCycleAllocation } from "@/features/assignments/domain/vocab-question-allocation";
import { resolveVocabUnitCycleAllocation } from "@/features/assignments/domain/vocab-unit-allocation";
import {
  extendScheduleSlotsFromRecurrence,
} from "@/features/assignments/domain/vocab-schedule";
import { resolveVocabUnitCountsForDates } from "@/lib/admin/vocab-unit-allocation";
import { bulkPlanSignature } from "@/features/assignments/domain/bulk-plan-signature";
import {
  loadCommonBulkAssignmentPlanningData,
  type BulkPlanningStudent,
} from "@/features/assignments/server/queries/bulk-assignment-planning-query";
import type {
  DatasetSummary,
  VocabUnitSummary,
} from "@/lib/admin/dataset-summary";
import type {
  BulkAssignmentCommonPlanSummary,
  BulkAssignmentPreview,
  BulkAssignmentPreviewFieldKey,
  BulkAssignmentPreviewItem,
  BulkAssignmentPreviewSession,
} from "../../contracts/bulk-assignment-response";
import {
  BulkAssignmentError,
} from "./bulk-assignment-errors";
import {
  resolveCanonicalBulkAssignmentPreview,
  type CanonicalPlannedQuestion,
} from "./canonical-assignment-preview";
import { MAXIMUM_BULK_QUESTION_COUNT } from "./bulk-assignment-limits";
import {
  createBulkAssignmentPreparationContext,
  mapInBatches,
  prepareCommonPlanSeries,
  type BulkAssignmentPreparationContext,
  type CommonPlanInput,
} from "./bulk-assignment-series-preparation";

function emptySessionError(sessionNumber: number) {
  return `${sessionNumber}회차에 배정할 다음 범위가 없습니다. 시험 횟수나 회차당 범위를 줄여 주세요.`;
}

function commonPlanSchedule(input: BulkAssignmentPreviewInput) {
  return input.commonPlan.sessions.map((session, index) => ({
    sessionNumber: index + 1,
    availableFrom: session.availableFrom,
    availableUntil: session.availableUntil,
  }));
}

function allocationIssueMessage(issue: VocabQuestionAllocationIssue) {
  if (issue === "invalid_available_count") {
    return "현재 범위에서 배정할 수 있는 단어가 4개보다 적습니다.";
  }
  if (issue === "invalid_question_count") {
    return "단어 수는 4개부터 500개까지 입력해 주세요.";
  }
  if (issue === "missing_schedule") {
    return "배정할 요일을 하나 이상 선택해 주세요.";
  }
  if (issue === "insufficient_for_selected_dates") {
    return "선택한 모든 날짜에 최소 4개씩 배정할 수 없습니다. 날짜를 줄이거나 범위를 넓혀 주세요.";
  }
  if (issue === "question_count_exceeds_capacity") {
    return "직접 입력한 단어 수가 현재 배정 가능한 단어 수보다 많습니다.";
  }
  if (issue === "session_question_limit_exceeded") {
    return "한 회차에는 최대 500개까지 배정할 수 있습니다. 날짜를 늘리거나 단어 수를 직접 입력해 주세요.";
  }
  return "한 번에 저장할 수 있는 시험 수를 넘었습니다. 학생 수나 배정 범위를 나눠서 배정해 주세요.";
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
  if (requiredSessionCount <= schedule.length) {
    return schedule.slice(0, requiredSessionCount);
  }
  if (
    schedule.some((slot) => !slot.availableFrom || !slot.availableUntil) ||
    recurrenceSchedule.some(
      (slot) => !slot.availableFrom || !slot.availableUntil,
    )
  ) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "같은 요일로 이어서 배정하려면 공개·마감 일정을 먼저 정해 주세요.",
    );
  }
  const baseSchedule = schedule.map((slot) => ({
    sessionNumber: slot.sessionNumber,
    date: slot.availableFrom!.slice(0, 10),
    availableLocalDateTime: slot.availableFrom!,
    deadlineLocalDateTime: slot.availableUntil!,
  }));
  const recurrenceBase = recurrenceSchedule.map((slot, index) => ({
    sessionNumber: index + 1,
    date: slot.availableFrom!.slice(0, 10),
    availableLocalDateTime: slot.availableFrom!,
    deadlineLocalDateTime: slot.availableUntil!,
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
          Boolean(session.error),
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

export type ResolvedBulkAssignmentPreview = {
  preview: BulkAssignmentPreview;
  targetPlansByStudent: Map<string, PlannedVocabSeriesTarget[][]>;
  canonicalPlansByStudent?: Map<string, CanonicalPlannedQuestion[]>;
};


export async function resolveBulkAssignmentPreview(
  input: BulkAssignmentPreviewInput,
  authenticatedAdmin?: AdminContext,
  context: BulkAssignmentPreparationContext =
    createBulkAssignmentPreparationContext(),
): Promise<ResolvedBulkAssignmentPreview> {
  const admin = authenticatedAdmin ?? (await requireAdmin());
  if (input.questionMode !== "book_meaning_choice") {
    return resolveCanonicalBulkAssignmentPreview(input, admin);
  }
  const commonPlan = input.commonPlan;
  const requestedSessionCount = commonPlan.sessions.length;
  if (
    input.studentIds.length * requestedSessionCount >
      MAXIMUM_BULK_ASSIGNMENT_COUNT
  ) {
    throw new BulkAssignmentError(
      "invalid_selection",
      `한 번에 저장할 수 있는 시험은 전체 ${MAXIMUM_BULK_ASSIGNMENT_COUNT}개까지입니다. 학생이나 회차를 줄여 주세요.`,
    );
  }
  const regularPreparationCache = context.regular;
  const planning = await loadCommonBulkAssignmentPlanningData(
    {
      datasetId: commonPlan.datasetId,
      studentIds: input.studentIds,
    },
    admin,
  );
  const students: BulkPlanningStudent[] = planning.students;
  const datasets: DatasetSummary[] = planning.dataset ? [planning.dataset] : [];
  const units: VocabUnitSummary[] = planning.units;
  await primeRegularAssignmentStudentCaches(
    {
      datasetId: commonPlan.datasetId,
      studentIds: input.studentIds,
    },
    regularPreparationCache,
  );
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
  let rangeLabel: string | null = null;
  try {
    rangeLabel = unitSelectionLabel(resolveOrderedUnitSelection(
      unitsByDataset.get(commonPlan.datasetId) ?? [],
      commonPlan.orderedUnitIds,
    ));
  } catch {
    rangeLabel = null;
  }
  const schedule = commonPlanSchedule(input);

  const targetPlansByStudent = new Map<
    string,
    PlannedVocabSeriesTarget[][]
  >();
  const items = await mapInBatches(
    input.studentIds,
    10,
      async (studentId) => {
      const student = studentById.get(studentId);
      const selectedDatasetId = commonPlan.datasetId;
      const dataset = selectedDatasetId
        ? datasetById.get(selectedDatasetId)
        : null;
      let rangeError: string | null = null;
      let orderedCommonUnits: (typeof units)[number][] = [];
      let resolvedSessions: Array<{
        sessionNumber: number;
        units: (typeof units)[number][];
        truncated: boolean;
      }> = [];
      if (dataset) {
        try {
          const datasetUnits = unitsByDataset.get(dataset.id) ?? [];
          orderedCommonUnits = resolveOrderedUnitSelection(
            datasetUnits,
            commonPlan.orderedUnitIds,
          );
          resolvedSessions = commonPlan.sessions.map((session, index) => ({
            sessionNumber: index + 1,
            units: resolveOrderedUnitSelection(datasetUnits, session.unitIds),
            truncated: false,
          }));
        } catch {
          rangeError = "선택한 공통 범위를 사용할 수 없습니다.";
        }
      }
      const blockedReason =
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
        resolvedSessions.length !== commonPlan.sessions.length ||
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
      {
        const commonUnits = commonPlan.splitBasis === "range_unit"
          ? orderedCommonUnits
          : resolvedSessions[0]?.units ?? [];
        try {
          const capacity = await calculateRegularAssignmentCapacity(
            {
              datasetId: dataset.id,
              unitIds: commonUnits.map((unit) => unit.id),
              studentIds: [studentId],
              englishToKoreanRatio: input.englishToKoreanRatio,
            },
            admin,
            regularPreparationCache,
          );
          availableQuestionCount = capacity.seriesMaximumQuestionCount;
          if (commonPlan.splitBasis === "range_unit") {
            const unitAllocationRule = commonPlan.unitAllocationRule;
            if (!unitAllocationRule) {
              throw new BulkAssignmentError(
                "invalid_selection",
                "회차별 범위 단위 규칙을 확인해 주세요.",
              );
            }
            const recurrenceDates = commonPlan.recurrenceSessions.flatMap(
              (session) => session.availableFrom
                ? [isoToKoreanDateTimeLocal(session.availableFrom).slice(0, 10)]
                : [],
            );
            if (
              recurrenceDates.length !== commonPlan.recurrenceSessions.length
            ) {
              throw new BulkAssignmentError(
                "invalid_selection",
                "범위 단위 배정의 공개 일정을 확인해 주세요.",
              );
            }
            const serverRangeUnitCounts = resolveVocabUnitCountsForDates({
              dates: recurrenceDates,
              rule: unitAllocationRule,
            });
            if (
              JSON.stringify(serverRangeUnitCounts) !==
                JSON.stringify(commonPlan.rangeUnitCounts)
            ) {
              throw new BulkAssignmentError(
                "invalid_selection",
                "요일별 단위 수가 원래 반복 일정의 규칙과 일치하지 않습니다.",
              );
            }
            const unitAllocation = resolveVocabUnitCycleAllocation({
              orderedUnitIds: commonPlan.orderedUnitIds,
              baseSessionUnitCounts: serverRangeUnitCounts,
              selectedDateCount: commonPlan.selectedDateCount,
              overflowPolicy: commonPlan.overflowPolicy,
              extraDatePolicy: commonPlan.extraDatePolicy,
              maximumSessionCount: MAXIMUM_BULK_ASSIGNMENT_COUNT,
            });
            if (unitAllocation.issue) {
              throw new BulkAssignmentError(
                "invalid_selection",
                "범위 단위와 회차 일정을 다시 확인해 주세요.",
              );
            }
            const actualSessionUnitIds = resolvedSessions.map((session) =>
              session.units.map((unit) => unit.id)
            );
            if (
              JSON.stringify(actualSessionUnitIds) !==
                JSON.stringify(unitAllocation.sessionUnitIds)
            ) {
              throw new BulkAssignmentError(
                "invalid_selection",
                "회차별 범위가 선택한 순서 또는 단위 수와 일치하지 않습니다.",
              );
            }
            defaultSessionCount = unitAllocation.defaultSessionCount;
            requiresExtraDateDecision =
              unitAllocation.requiresExtraDateDecision;
            resolvedSessions.forEach((session, index) => {
              cycleIndexBySession.set(
                session.sessionNumber,
                unitAllocation.sessionCycleIndexes[index] ?? 0,
              );
            });
          } else {
            const allocation = resolveVocabQuestionCycleAllocation({
              availableQuestionCount,
              distribution: commonPlan.distribution,
              questionCount: commonPlan.questionCount,
              selectedDateCount: commonPlan.selectedDateCount,
              overflowPolicy: commonPlan.overflowPolicy,
              extraDatePolicy: commonPlan.extraDatePolicy,
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
              commonPlan.recurrenceSessions,
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
          }
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
          const unitIds = resolved.units.map((unit) => unit.id);
          const sessionBase = {
            sessionNumber: resolved.sessionNumber,
            sourceSessionNumber: resolved.sessionNumber,
            cycleIndex: cycleIndexBySession.get(resolved.sessionNumber) ?? 0,
            unitId: resolved.units[0]?.id ?? null,
            unitLabel: unitSelectionLabel(resolved.units),
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
              error: emptySessionError(resolved.sessionNumber),
              errorFieldKey: "range" as const,
            };
          }
          try {
            const capacity = {
              ...await calculateRegularAssignmentCapacity(
                {
                  datasetId: dataset.id,
                  unitIds,
                  studentIds: [studentId],
                  englishToKoreanRatio: input.englishToKoreanRatio,
                },
                admin,
                regularPreparationCache,
              ),
              wrongEligible: 0,
            };
            const plannedQuestionCount = plannedQuestionCountBySession.get(
              resolved.sessionNumber,
            );
            const unitSplitQuestionCount = commonPlan.splitBasis === "range_unit"
              ? commonPlan.questionCount.mode === "manual"
                ? commonPlan.questionCount.value
                : capacity.maximumQuestionCount
              : undefined;
            const resolvedQuestionCount = plannedQuestionCount ??
              unitSplitQuestionCount;
            const capacityError =
              capacity.maximumQuestionCount < capacity.minimumQuestionCount
                  ? "현재 범위에서 배정할 수 있는 단어가 부족합니다."
                  : resolvedQuestionCount !== undefined &&
                      resolvedQuestionCount > capacity.maximumQuestionCount
                    ? `현재 회차는 최대 ${capacity.maximumQuestionCount}개까지 배정할 수 있습니다.`
                  : null;
            const error = capacityError;
            return {
              ...sessionBase,
              available: error === null,
              questionCount: error
                ? 0
                : resolvedQuestionCount ?? capacity.recommendedQuestionCount,
              error,
              ...(capacityError
                ? { errorFieldKey: "questionCount" as const }
                : {}),
            };
          } catch (error) {
            return {
              ...sessionBase,
              available: false,
              questionCount: 0,
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
      let orderedSessions = normalizedSessions;
      const firstError = orderedSessions.find(
        (session) => !session.available,
      )?.error;
      const firstErrorFieldKey = orderedSessions.find(
        (session) => !session.available,
      )?.errorFieldKey;
      let seriesPreparationError: string | null = null;
      if (
        dataset &&
        availableQuestionCount !== null &&
        orderedSessions.length > 0 &&
        orderedSessions.every((session) => session.available)
      ) {
        try {
          const preparation = await prepareCommonPlanSeries({
            request: input,
            commonPlan,
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
          targetPlansByStudent.set(studentId, preparation.sessionTargets);
        } catch (error) {
          seriesPreparationError = error instanceof Error
            ? error.message
            : "회차별 출제 대상을 확정하지 못했습니다.";
        }
      }
      if (availableQuestionCount !== null) {
        scheduledQuestionCount = orderedSessions.reduce(
          (total, session) => total + session.questionCount,
          0,
        );
        selectedQuestionCount = commonPlan.distribution === "split"
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
          seriesPreparationError === null &&
          orderedSessions.length > 0 &&
          orderedSessions.every((session) => session.available),
        sessions: orderedSessions,
        availableQuestionCount,
        selectedQuestionCount,
        remainingQuestionCount,
        defaultSessionCount,
        scheduledQuestionCount,
        requiresExtraDateDecision,
        error: firstError ?? seriesPreparationError,
        ...(firstErrorFieldKey || seriesPreparationError
          ? {
              errorFieldKey:
                firstErrorFieldKey ?? ("questionCount" as const),
            }
          : {}),
      };
    },
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
            : `한 번에 저장할 수 있는 단어는 전체 ${MAXIMUM_BULK_QUESTION_COUNT.toLocaleString("ko-KR")}개까지입니다. 학생·회차·단어 수를 줄여 주세요.`,
          errorFieldKey: "questionCount" as const,
        })
    : items;

  const preview: BulkAssignmentPreview = {
    items: boundedItems,
    assignableCount: boundedItems.filter(
      (item) => item.available && item.sessions.length > 0,
    ).length,
    blockedCount: boundedItems.filter((item) => !item.available).length,
    assignmentCount,
    commonPlanSummary: buildCommonPlanSummary(boundedItems),
    planSignature: resolvedBulkPlanSha256(
      boundedItems.map((item) => ({
        studentId: item.studentId,
        datasetId: item.datasetId,
        sessions: item.sessions.map((session, index) => ({
          sessionNumber: session.sessionNumber,
          sourceSessionNumber: session.sourceSessionNumber,
          cycleIndex: session.cycleIndex,
          unitIds: session.unitIds,
          questionCount: session.questionCount,
          availableFrom: session.availableFrom,
          availableUntil: session.availableUntil,
          targets: targetPlansByStudent.get(item.studentId)?.[index] ?? [],
        })),
      })),
      {
        questionMode: input.questionMode,
        distribution: commonPlan.distribution,
        splitBasis: commonPlan.splitBasis,
        orderedUnitIds: commonPlan.orderedUnitIds,
        rangeUnitCounts: commonPlan.rangeUnitCounts,
        unitAllocationRule: commonPlan.unitAllocationRule,
        questionCount: commonPlan.questionCount,
        overflowPolicy: commonPlan.overflowPolicy,
        extraDatePolicy: commonPlan.extraDatePolicy,
        selectedDateCount: commonPlan.selectedDateCount,
        selectionMode: commonPlan.selectionMode,
        recurrenceSessions: commonPlan.recurrenceSessions,
      },
    ),
    rangeLabel,
  };
  return {
    preview,
    targetPlansByStudent,
  };
}

export async function previewBulkAssignments(
  input: BulkAssignmentPreviewInput,
  authenticatedAdmin?: AdminContext,
): Promise<BulkAssignmentPreview> {
  return (await resolveBulkAssignmentPreview(input, authenticatedAdmin)).preview;
}
