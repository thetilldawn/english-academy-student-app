import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { ExamSettings } from "./model";
import type {
  VocabSplitOverflowPolicy,
  VocabUnitAllocationRuleV1,
} from "./vocab-assignment-contract";
import { shiftCalendarDate } from "./vocab-schedule";

export type PreviousVocabExamSource = {
  assignmentDeleted: boolean;
  assignmentId: string;
  assignmentPurpose: "regular" | "review" | "mixed";
  assignmentTitle: string;
  assignedAt: string;
  availableFrom: string | null;
  availableUntil: string | null;
  datasetId: string;
  datasetTitle: string;
  englishToKoreanRatio: number;
  passingScore: number;
  questionOrderMode: "fixed" | "ascending" | "descending" | "random";
  questionTimeLimitSeconds: number | null;
  status: "not_started" | "cancelled" | "missed" | "in_progress" | "completed" | "expired";
  studentId: string;
  studentName: string;
  timeLimitSeconds: number;
  timingMode: "none" | "total" | "per_question";
  vocabUnitAllocation?: {
    rule: VocabUnitAllocationRuleV1;
    overflowPolicy: VocabSplitOverflowPolicy;
  } | null;
};

export type PreviousVocabExamConditions = {
  assignmentId: string;
  assignmentTitle: string;
  datasetId: string;
  exam: ExamSettings;
  scheduleRule: {
    availableTime: string;
    deadlineDayOffset: number;
    deadlineTime: string;
  } | null;
  unitAllocation: {
    rule: VocabUnitAllocationRuleV1;
    overflowPolicy: VocabSplitOverflowPolicy;
  } | null;
  sourceStudentId: string;
  sourceStudentName: string;
};

function directionRatio(value: number): 0 | 50 | 100 | null {
  return value === 0 || value === 50 || value === 100 ? value : null;
}

function deadlineDayOffset(availableDate: string, deadlineDate: string) {
  for (let offset = 0; offset <= 30; offset += 1) {
    if (shiftCalendarDate(availableDate, offset) === deadlineDate) return offset;
  }
  return null;
}

function scheduleRule(item: PreviousVocabExamSource) {
  if (
    !item.availableFrom ||
    !item.availableUntil ||
    Date.parse(item.availableUntil) <= Date.parse(item.availableFrom)
  ) {
    return null;
  }
  const available = isoToKoreanDateTimeLocal(item.availableFrom);
  const deadline = isoToKoreanDateTimeLocal(item.availableUntil);
  const [availableDate, availableTime] = available.split("T");
  const [deadlineDate, deadlineTime] = deadline.split("T");
  const offset = deadlineDayOffset(availableDate, deadlineDate);
  if (!availableTime || !deadlineTime || offset === null) return null;
  return { availableTime, deadlineDayOffset: offset, deadlineTime };
}

function toConditions(
  item: PreviousVocabExamSource,
): PreviousVocabExamConditions | null {
  const ratio = directionRatio(item.englishToKoreanRatio);
  if (ratio === null) return null;
  const timing = item.timingMode === "none"
    ? { mode: "total" as const, totalSeconds: 300 }
    : item.timingMode === "per_question"
    ? item.questionTimeLimitSeconds
      ? {
          mode: "per_question" as const,
          perQuestionSeconds: item.questionTimeLimitSeconds,
        }
      : null
    : item.timeLimitSeconds > 0
      ? { mode: "total" as const, totalSeconds: item.timeLimitSeconds }
      : null;
  if (!timing) return null;
  return {
    assignmentId: item.assignmentId,
    assignmentTitle: item.assignmentTitle.trim() || item.datasetTitle,
    datasetId: item.datasetId,
    exam: {
      directionRatio: ratio,
      passingScore: item.passingScore,
      questionOrderMode: item.questionOrderMode === "random"
        ? "random"
        : "ascending",
      timeLimitEnabled: item.timingMode !== "none",
      timing,
    },
    scheduleRule: scheduleRule(item),
    unitAllocation: item.vocabUnitAllocation ?? null,
    sourceStudentId: item.studentId,
    sourceStudentName: item.studentName,
  };
}

function sequenceTime(item: PreviousVocabExamSource) {
  return Date.parse(item.availableFrom ?? item.assignedAt) || 0;
}

export function selectPreviousVocabExamConditions(input: {
  datasetId: string;
  history: readonly PreviousVocabExamSource[];
  studentId: string;
}): PreviousVocabExamConditions | null {
  const candidates = input.history
    .filter(
      (item) =>
        item.studentId === input.studentId &&
        item.datasetId === input.datasetId &&
        item.assignmentPurpose !== "review" &&
        !item.assignmentDeleted &&
        item.status !== "cancelled",
    )
    .toSorted((left, right) =>
      sequenceTime(right) - sequenceTime(left) ||
      Date.parse(right.assignedAt) - Date.parse(left.assignedAt) ||
      right.assignmentId.localeCompare(left.assignmentId)
    );
  for (const candidate of candidates) {
    const conditions = toConditions(candidate);
    if (conditions) return conditions;
  }
  return null;
}
