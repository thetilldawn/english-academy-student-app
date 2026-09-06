import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { AssignmentDatasetItem, AssignmentUnitItem } from "../catalog-types";
import type { VocabRangeDistribution, VocabScheduleSlot } from "../domain/vocab-assignment-contract";
import { assignmentUnitRangeLabel } from "./assignment-unit-range-label";

export type VocabScheduleFieldErrors = Partial<Record<
  "startDate" | "weekdays" | "availableTime" | "deadlineOffset" | "deadlineTime" |
  `session-${number}-available` | `session-${number}-deadline`, string
>>;

export function vocabScheduleLabels(input: {
  selectedDataset?: AssignmentDatasetItem | null;
  representativeDatasetLabel?: string | null;
  selectedUnits: readonly Pick<AssignmentUnitItem, "label" | "sortIndex">[];
}) {
  return {
    datasetLabel: input.selectedDataset
      ? cataloguedDatasetDisplayLabel(input.selectedDataset)
      : input.representativeDatasetLabel ?? "단어장 미선택",
    rangeLabel: input.selectedUnits.length === 0
      ? "범위 미선택"
      : assignmentUnitRangeLabel(
          input.selectedUnits.map(unit => unit.label),
          input.selectedUnits.map(unit => unit.sortIndex),
        ),
  };
}

function sessionDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("ko-KR", {
        month: "long", day: "numeric", weekday: "short", timeZone: "UTC",
      }).format(parsed);
}

export type VocabScheduleSessionRow = {
  sessionNumber: number;
  label: string;
  editable: boolean;
  queued: boolean;
  availableLocalDateTime: string;
  deadlineLocalDateTime: string;
  generatedTimeLabel: string;
  availableError?: string;
  deadlineError?: string;
};

export function vocabScheduleSessionRows(input: {
  slots: readonly VocabScheduleSlot[];
  hasSelectedWeekdays: boolean;
  previewSessions: readonly {
    sessionNumber: number;
    availableFrom: string | null;
    availableUntil?: string | null;
    questionCount: number;
  }[];
  distribution: VocabRangeDistribution;
  availableTimeEnabled: boolean;
  fieldErrors?: VocabScheduleFieldErrors;
}): VocabScheduleSessionRow[] {
  const previewSessions = input.hasSelectedWeekdays ? input.previewSessions : [];
  return Array.from({ length: Math.max(input.slots.length, previewSessions.length) }, (_, index) => {
    const slot = input.slots[index] ?? null;
    const preview = previewSessions[index] ?? null;
    const availableLocalDateTime = slot?.availableLocalDateTime ??
      (preview ? isoToKoreanDateTimeLocal(preview.availableFrom) : "");
    const deadlineLocalDateTime = slot?.deadlineLocalDateTime ??
      (preview?.availableUntil ? isoToKoreanDateTimeLocal(preview.availableUntil) : "");
    const date = slot?.date ?? availableLocalDateTime.slice(0, 10);
    const sessionNumber = preview?.sessionNumber ?? slot?.sessionNumber ?? index + 1;
    const questionCount = preview?.questionCount ?? null;
    return {
      sessionNumber,
      label: `${sessionNumber}회차 [${sessionDateLabel(date)}]${questionCount === null ? "" : ` ${questionCount}개`}`,
      editable: slot !== null,
      queued: input.distribution === "split" && sessionNumber > 1,
      availableLocalDateTime,
      deadlineLocalDateTime,
      generatedTimeLabel: (input.availableTimeEnabled
        ? `공개 ${availableLocalDateTime.slice(11, 16)}`
        : "즉시 공개") + (deadlineLocalDateTime
          ? ` / 마감 ${deadlineLocalDateTime.slice(0, 10)} ${deadlineLocalDateTime.slice(11, 16)}`
          : ""),
      availableError: input.fieldErrors?.[`session-${sessionNumber}-available`],
      deadlineError: input.fieldErrors?.[`session-${sessionNumber}-deadline`],
    };
  });
}
