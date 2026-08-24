import "server-only";

import type { BulkAssignmentInput } from "@/lib/admin/bulk-assignment-request";

const SEOUL_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;
const MAXIMUM_QUEUE_WINDOW_SECONDS = 365 * 24 * 60 * 60;

export class VocabAssignmentQueuePlanError extends Error {}

function toSeoulRecurrenceSlot(input: {
  availableFrom: string;
  availableUntil: string | null;
}) {
  if (!input.availableUntil) {
    throw new VocabAssignmentQueuePlanError(
      "배정된 시험의 반복 일정에는 마감이 필요합니다.",
    );
  }
  const from = Date.parse(input.availableFrom);
  const until = Date.parse(input.availableUntil);
  const durationSeconds = Math.floor((until - from) / 1000);
  if (durationSeconds < 60 || durationSeconds > MAXIMUM_QUEUE_WINDOW_SECONDS) {
    throw new VocabAssignmentQueuePlanError(
      "배정된 시험의 공개·마감 간격은 1분부터 365일까지 설정할 수 있습니다.",
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

export function buildVocabAssignmentQueueSeriesPayload(input: {
  commonPlan: NonNullable<BulkAssignmentInput["commonPlan"]>;
  rangeLabel: string | null;
  previewItems: ReadonlyArray<{
    studentId: string;
    datasetId: string | null;
    datasetLabel: string | null;
    sessionCount: number;
  }>;
  batches: readonly Record<string, unknown>[];
}) {
  if (input.commonPlan.distribution !== "split") {
    throw new VocabAssignmentQueuePlanError(
      "완료 뒤 다음 시험 생성은 회차별 배정에서만 사용할 수 있습니다.",
    );
  }
  const batchesByStudent = new Map<string, Record<string, unknown>[]>();
  for (const batch of input.batches) {
    const studentId = batch.student_id;
    if (typeof studentId !== "string") {
      throw new VocabAssignmentQueuePlanError(
        "저장할 학생별 시험 자료를 확인할 수 없습니다.",
      );
    }
    const current = batchesByStudent.get(studentId) ?? [];
    current.push(batch);
    batchesByStudent.set(studentId, current);
  }

  const recurrenceSlots = input.commonPlan.recurrenceSessions.map(
    toSeoulRecurrenceSlot,
  );
  const expectedBatchCount = input.previewItems.reduce(
    (total, item) => total + item.sessionCount,
    0,
  );
  if (expectedBatchCount !== input.batches.length) {
    throw new VocabAssignmentQueuePlanError(
      "전체 완료 뒤 생성 회차가 미리보기와 일치하지 않습니다.",
    );
  }
  return input.previewItems
    .filter((item) => item.sessionCount > 0)
    .map((item) => {
      const items = (batchesByStudent.get(item.studentId) ?? []).toSorted(
        (left, right) =>
          Number(left.session_number) - Number(right.session_number),
      );
      if (
        !item.datasetId ||
        !item.datasetLabel ||
        items.length !== item.sessionCount
      ) {
        throw new VocabAssignmentQueuePlanError(
          "학생별 완료 뒤 생성 회차가 미리보기와 일치하지 않습니다.",
        );
      }
      return {
        student_id: item.studentId,
        dataset_id: item.datasetId,
        dataset_label: item.datasetLabel,
        range_label: input.rangeLabel ?? "선택 범위",
        recurrence_slots: recurrenceSlots,
        items,
      };
    })
    .toSorted((left, right) => left.student_id.localeCompare(right.student_id));
}
