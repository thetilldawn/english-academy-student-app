import type { AssignmentDraftIssue } from "./validation";
import type {
  VocabQuestionCountChoice,
  VocabRangeDistribution,
  VocabScheduleDraft,
  VocabScheduleSlot,
  VocabSplitOverflowPolicy,
  VocabTargetSelectionMode,
} from "./vocab-assignment-plan";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isCalendarDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function isLocalDateTime(value: string) {
  const [date, time, extra] = value.split("T");
  return !extra && isCalendarDate(date ?? "") && TIME_PATTERN.test(time ?? "");
}

export function validateVocabPlannerInputs(input: {
  datasetId: string;
  selectedUnitIds: readonly string[];
  distribution: VocabRangeDistribution;
  questionCount: VocabQuestionCountChoice;
  overflowPolicy: VocabSplitOverflowPolicy;
  selectionMode: VocabTargetSelectionMode;
  schedule: VocabScheduleDraft;
  scheduleSlots: readonly VocabScheduleSlot[];
}): AssignmentDraftIssue[] {
  const issues: AssignmentDraftIssue[] = [];
  if (!input.datasetId) {
    issues.push({
      code: "required",
      path: "commonPlan.datasetId",
      message: "단어장을 선택해 주세요.",
    });
  }
  if (input.selectedUnitIds.length === 0) {
    issues.push({
      code: "required",
      path: "commonPlan.sessions.0.unitIds",
      message: "시험 범위를 선택해 주세요.",
    });
  }
  if (
    input.questionCount.mode === "manual" &&
    (!Number.isInteger(input.questionCount.value) ||
      input.questionCount.value < 4 ||
      input.questionCount.value > 500)
  ) {
    issues.push({
      code: "out_of_range",
      path: "commonPlan.questionCount",
      message: "문항 수는 4개부터 500개까지 입력해 주세요.",
    });
  }
  if (
    input.overflowPolicy === "continue_weekly" &&
    (input.distribution !== "split" || input.questionCount.mode !== "manual")
  ) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.overflowPolicy",
      message: "같은 요일로 이어서는 나누기·직접 입력에서만 선택할 수 있습니다.",
    });
  }
  if (!["source_order", "random"].includes(input.selectionMode)) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.selectionMode",
      message: "문제 순서를 선택해 주세요.",
    });
  }
  if (!isCalendarDate(input.schedule.startDate)) {
    issues.push({
      code: "invalid_datetime",
      path: "commonPlan.schedule.startDate",
      message: "배정 기준일을 확인해 주세요.",
    });
  }
  if (input.schedule.weekdays.length === 0) {
    issues.push({
      code: "required",
      path: "commonPlan.sessions",
      message: "배정할 요일을 하나 이상 선택해 주세요.",
    });
  }
  if (!TIME_PATTERN.test(input.schedule.availableTime)) {
    issues.push({
      code: "invalid_datetime",
      path: "commonPlan.schedule.availableTime",
      message: "공개 시작 시각을 확인해 주세요.",
    });
  }
  if (
    !Number.isInteger(input.schedule.deadlineDayOffset) ||
    input.schedule.deadlineDayOffset < 0 ||
    input.schedule.deadlineDayOffset > 30
  ) {
    issues.push({
      code: "out_of_range",
      path: "commonPlan.schedule.deadlineDayOffset",
      message: "마감일은 당일부터 30일 뒤까지 선택해 주세요.",
    });
  }
  if (!TIME_PATTERN.test(input.schedule.deadlineTime)) {
    issues.push({
      code: "invalid_datetime",
      path: "commonPlan.schedule.deadlineTime",
      message: "마감 시각을 확인해 주세요.",
    });
  }
  input.scheduleSlots.forEach((slot, index) => {
    const availableValid = isLocalDateTime(slot.availableLocalDateTime);
    const deadlineValid = isLocalDateTime(slot.deadlineLocalDateTime);
    if (!availableValid) {
      issues.push({
        code: "invalid_datetime",
        path: `commonPlan.sessions.${index}.availableLocalDateTime`,
        message: `${index + 1}회차 공개 시작을 확인해 주세요.`,
      });
    }
    if (!deadlineValid) {
      issues.push({
        code: "invalid_datetime",
        path: `commonPlan.sessions.${index}.deadlineLocalDateTime`,
        message: `${index + 1}회차 마감을 확인해 주세요.`,
      });
    }
    if (
      availableValid &&
      deadlineValid &&
      Date.parse(slot.deadlineLocalDateTime) <=
        Date.parse(slot.availableLocalDateTime)
    ) {
      issues.push({
        code: "invalid_order",
        path: `commonPlan.sessions.${index}.deadlineLocalDateTime`,
        message: `${index + 1}회차 마감은 공개 시작보다 뒤여야 합니다.`,
      });
    }
  });
  return issues;
}
