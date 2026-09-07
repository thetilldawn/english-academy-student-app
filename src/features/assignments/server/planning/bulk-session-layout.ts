import "server-only";
import type { BulkAssignmentPreviewInput } from "../../contracts/bulk-assignment-request";
import type { BulkAssignmentPreviewItem, BulkAssignmentCommonPlanSummary } from "../../contracts/bulk-assignment-response";
import { bulkPlanSignature } from "../../domain/bulk-plan-signature";
import { extendScheduleSlotsFromRecurrence } from "../../domain/vocab-schedule";
import { BulkAssignmentError } from "../use-cases/bulk-assignment-errors";
type CommonPlanInput = BulkAssignmentPreviewInput["commonPlan"];

export function commonPlanSchedule(input: BulkAssignmentPreviewInput) {
  return input.commonPlan.sessions.map((session, index) => ({
    sessionNumber: index + 1,
    availableFrom: session.availableFrom,
    availableUntil: session.availableUntil,
  }));
}

export function extendCommonPlanSchedule(
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

export function buildCommonPlanSummary(
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
    totalAvailableQuestionCount: representative.totalAvailableQuestionCount ?? null,
    maximumSessionQuestionCount: representative.maximumSessionQuestionCount ?? null,
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
