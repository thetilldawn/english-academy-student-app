import type { ExamTiming } from "./model";
import {
  ISO_WEEKDAYS,
  type IsoWeekday,
  type VocabSplitOverflowPolicy,
  type VocabUnitAllocationMode,
  type VocabUnitAllocationRuleV1,
  type VocabWeekdayUnitCounts,
} from "@/lib/admin/vocab-unit-allocation";

export {
  ISO_WEEKDAYS,
  type IsoWeekday,
  type VocabSplitOverflowPolicy,
  type VocabUnitAllocationMode,
  type VocabUnitAllocationRuleV1,
  type VocabWeekdayUnitCounts,
};
export type VocabAssignmentEntryMode = "student" | "school" | "dataset";
export type VocabAssignmentMode =
  | "all_sessions"
  | "per_session"
  | "word_count";
export type VocabRangeDistribution = "split" | "repeat";
export type VocabSplitBasis = "question_count" | "range_unit";
export type VocabQuestionCountChoice =
  | { mode: "all" }
  | { mode: "manual"; value: number };
export type VocabExtraDatePolicy =
  | "unconfirmed"
  | "repeat_from_start";
export type VocabTargetSelectionMode = "source_order" | "random";
export type VocabTargetDirection =
  | "english_to_korean"
  | "korean_to_english";

export function resolveVocabAssignmentMode(
  mode: VocabAssignmentMode,
): {
  distribution: VocabRangeDistribution;
  splitBasis: VocabSplitBasis;
} {
  switch (mode) {
    case "all_sessions":
      return { distribution: "repeat", splitBasis: "question_count" };
    case "per_session":
      return { distribution: "split", splitBasis: "range_unit" };
    case "word_count":
      return { distribution: "split", splitBasis: "question_count" };
  }
}
export type VocabSeriesTarget = {
  id: number;
  eligibleDirections: readonly VocabTargetDirection[];
  conflictKeys?: Partial<
    Record<VocabTargetDirection, { promptKey: string; answerKey: string }>
  >;
};
export type PlannedVocabSeriesTarget = {
  id: number;
  direction: VocabTargetDirection;
};

export const MINIMUM_VOCAB_SESSION_QUESTION_COUNT = 4;
export const MAXIMUM_VOCAB_SESSION_QUESTION_COUNT = 500;

export type VocabQuestionAllocationIssue =
  | "invalid_available_count"
  | "invalid_question_count"
  | "missing_schedule"
  | "insufficient_for_selected_dates"
  | "question_count_exceeds_capacity"
  | "session_question_limit_exceeded"
  | "series_session_limit_exceeded";

export type VocabQuestionAllocation = {
  sessionQuestionCounts: number[];
  selectedQuestionCount: number;
  remainingQuestionCount: number;
  extraSessionCount: number;
  issue: VocabQuestionAllocationIssue | null;
};

export type VocabQuestionCycleAllocation = VocabQuestionAllocation & {
  baseSessionQuestionCounts: number[];
  defaultSessionCount: number;
  requiresExtraDateDecision: boolean;
  scheduledQuestionCount: number;
  sessionCycleIndexes: number[];
};

export type VocabUnitCycleAllocationIssue =
  | "missing_units"
  | "missing_schedule"
  | "invalid_unit_count"
  | "series_session_limit_exceeded";

export type VocabUnitCycleAllocation = {
  sessionUnitIds: string[][];
  remainingUnitIds: string[];
  defaultSessionCount: number;
  requiresExtraDateDecision: boolean;
  sessionCycleIndexes: number[];
  issue: VocabUnitCycleAllocationIssue | null;
};

export function resolveExtraDateCancelSessionCount(
  items: readonly {
    defaultSessionCount: number | null;
    requiresExtraDateDecision: boolean;
  }[],
  fallback: number,
) {
  const counts = items
    .filter((item) => item.requiresExtraDateDecision)
    .flatMap((item) => item.defaultSessionCount === null
      ? []
      : [item.defaultSessionCount]);
  return counts.length > 0 ? Math.min(...counts) : fallback;
}

export type VocabUnitSelection = {
  selectedUnitIds: readonly string[];
};

export type VocabScheduleDraft = {
  startDate: string;
  weekdays: readonly IsoWeekday[];
  availableTimeEnabled?: boolean;
  availableTime: string;
  deadlineDayOffset: number;
  deadlineTime: string;
};

export type VocabTimeTemplate = {
  id: string;
  label: string;
  availableTime: string;
  deadlineDayOffset: number;
  deadlineTime: string;
  timeLimitEnabled?: boolean;
  timing: ExamTiming;
};

export type VocabScheduleSlot = {
  sessionNumber: number;
  date: string;
  availableLocalDateTime: string;
  deadlineLocalDateTime: string;
};

export type VocabScheduleSlotOverride = Pick<
  VocabScheduleSlot,
  "availableLocalDateTime" | "deadlineLocalDateTime"
>;
