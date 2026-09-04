import { z } from "zod";

import { koreanDateTimeLocalToIso } from "@/lib/deadline";

import {
  MAXIMUM_BULK_ASSIGNMENT_COUNT,
  MAXIMUM_BULK_STUDENT_COUNT,
  type AssignmentAvailability,
  type AssignmentDeadline,
  type AssignmentDraft,
  type BulkSeriesAssignmentDraft,
  type DirectReviewAssignmentDraft,
  type ExamSettings,
  type LegacyReviewRecoveryDraft,
  type ResolvedSingleAssignment,
  type ReviewPolicy,
  type SingleAssignmentDraft,
} from "./model";
import { ISO_WEEKDAYS } from "./vocab-assignment-contract";
import { resolveVocabUnitCountsForDates } from "./vocab-schedule";
import {
  resolveUndatedVocabUnitCycleAllocation,
  resolveVocabUnitCycleAllocation,
} from "./vocab-unit-allocation";

export type AssignmentDraftIssueCode =
  | "required"
  | "duplicate"
  | "out_of_range"
  | "invalid_datetime"
  | "invalid_order"
  | "invalid_id";

export type AssignmentDraftIssue = {
  code: AssignmentDraftIssueCode;
  path: string;
  message: string;
};

export class InvalidAssignmentDraftError extends Error {
  constructor(public readonly issues: readonly AssignmentDraftIssue[]) {
    super(issues[0]?.message ?? "배정 조건을 확인해 주세요.");
    this.name = "InvalidAssignmentDraftError";
  }
}

function integerInRange(value: number, minimum: number, maximum: number) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function sameOrderedValues<T>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateId(
  value: string,
  path: string,
  issues: AssignmentDraftIssue[],
) {
  if (!value) {
    issues.push({ code: "required", path, message: "대상을 선택해 주세요." });
  } else if (!z.uuid().safeParse(value).success) {
    issues.push({
      code: "invalid_id",
      path,
      message: "대상 식별자를 확인해 주세요.",
    });
  }
}

function validateUniqueIds(
  ids: readonly string[],
  path: string,
  issues: AssignmentDraftIssue[],
) {
  if (ids.length === 0) {
    issues.push({ code: "required", path, message: "대상을 선택해 주세요." });
  }
  ids.forEach((id, index) => validateId(id, `${path}.${index}`, issues));
  if (new Set(ids).size !== ids.length) {
    issues.push({
      code: "duplicate",
      path,
      message: "같은 대상을 두 번 선택할 수 없습니다.",
    });
  }
}

function deadlineIso(
  deadline: AssignmentDeadline,
  path: string,
  issues: AssignmentDraftIssue[],
): string | null {
  if (deadline.mode === "none") return null;
  const iso = koreanDateTimeLocalToIso(deadline.koreanLocalDateTime);
  if (!iso) {
    issues.push({
      code: "invalid_datetime",
      path,
      message: "한국시간 날짜와 시간을 확인해 주세요.",
    });
  }
  return iso;
}

function availabilityIso(
  availability: AssignmentAvailability,
  path: string,
  issues: AssignmentDraftIssue[],
): string | null {
  if (availability.mode === "immediate") return null;
  const iso = koreanDateTimeLocalToIso(availability.koreanLocalDateTime);
  if (!iso) {
    issues.push({
      code: "invalid_datetime",
      path,
      message: "공개 날짜와 시간을 확인해 주세요.",
    });
  }
  return iso;
}

function validateReviewLevels(
  review: ReviewPolicy,
  issues: AssignmentDraftIssue[],
  path = "review.levels",
) {
  if (review.levels.length === 0) {
    issues.push({
      code: "required",
      path,
      message: "포함할 오답 단계를 하나 이상 선택해 주세요.",
    });
  }
  if (new Set(review.levels).size !== review.levels.length) {
    issues.push({
      code: "duplicate",
      path,
      message: "같은 오답 단계를 두 번 선택할 수 없습니다.",
    });
  }
  if (review.levels.some((level) => level !== 1 && level !== 2)) {
    issues.push({
      code: "out_of_range",
      path,
      message: "오답 단계는 1회 또는 2회 이상만 선택할 수 있습니다.",
    });
  }
}

function validateDirection(exam: ExamSettings, issues: AssignmentDraftIssue[]) {
  if (![0, 50, 100].includes(exam.directionRatio)) {
    issues.push({
      code: "out_of_range",
      path: "exam.directionRatio",
      message: "출제 방향을 확인해 주세요.",
    });
  }
}

function validateExamSettings(
  exam: ExamSettings,
  issues: AssignmentDraftIssue[],
) {
  validateDirection(exam, issues);
  if (
    !["ascending", "descending", "random"].includes(
      exam.questionOrderMode,
    )
  ) {
    issues.push({
      code: "out_of_range",
      path: "exam.questionOrderMode",
      message: "출제 순서를 확인해 주세요.",
    });
  }
  if (!integerInRange(exam.passingScore, 0, 100)) {
    issues.push({
      code: "out_of_range",
      path: "exam.passingScore",
      message: "통과 점수는 0점부터 100점까지 입력해 주세요.",
    });
  }
  if (
    exam.retryEnabled !== false &&
    !integerInRange(exam.retryPassingScore ?? exam.passingScore, 0, 100)
  ) {
    issues.push({
      code: "out_of_range",
      path: "exam.retryPassingScore",
      message: "재시험 통과 점수는 0점부터 100점까지 입력해 주세요.",
    });
  }
  if (
    exam.timeLimitEnabled !== false &&
    exam.timing.mode === "total" &&
    !integerInRange(exam.timing.totalSeconds, 30, 10800)
  ) {
    issues.push({
      code: "out_of_range",
      path: "exam.timing.totalSeconds",
      message: "전체 시험 시간은 30초부터 180분까지 설정해 주세요.",
    });
  }
  if (
    exam.timeLimitEnabled !== false &&
    exam.timing.mode === "per_question" &&
    !integerInRange(exam.timing.perQuestionSeconds, 5, 600)
  ) {
    issues.push({
      code: "out_of_range",
      path: "exam.timing.perQuestionSeconds",
      message: "문제당 시간은 5초부터 600초까지 설정해 주세요.",
    });
  }
}

export function validateDirectReviewAssignmentSubmission(
  draft: DirectReviewAssignmentDraft,
  wrongEligible: number,
  nowMilliseconds: number,
): readonly AssignmentDraftIssue[] {
  const issues: AssignmentDraftIssue[] = [];
  validateId(draft.studentId, "studentId", issues);
  validateId(draft.datasetId, "datasetId", issues);
  validateReviewLevels(
    { mode: "pending", scope: "dataset", levels: draft.reviewLevels },
    issues,
    "reviewLevels",
  );
  validateExamSettings(draft.exam, issues);

  if (!integerInRange(draft.questionCount, 1, 400)) {
    issues.push({
      code: "out_of_range",
      path: "questionCount",
      message:
        draft.questionCount < 1
          ? "배정할 오답이 없습니다."
          : "오답 시험은 400개까지 배정할 수 있습니다.",
    });
  } else if (draft.questionCount !== wrongEligible) {
    issues.push({
      code: "invalid_order",
      path: "questionCount",
      message: "오답 목록이 바뀌었습니다. 단어 수를 다시 확인해 주세요.",
    });
  }

  const availableFrom = availabilityIso(
    draft.availability,
    "availability",
    issues,
  );
  const deadline = deadlineIso(draft.deadline, "deadline", issues);
  if (deadline && Date.parse(deadline) <= nowMilliseconds) {
    issues.push({
      code: "invalid_datetime",
      path: "deadline",
      message: "응시 마감은 현재보다 뒤로 정해 주세요.",
    });
  }
  if (
    availableFrom &&
    deadline &&
    Date.parse(deadline) <= Date.parse(availableFrom)
  ) {
    issues.push({
      code: "invalid_order",
      path: "deadline",
      message: "응시 마감은 공개 시각보다 뒤로 정해 주세요.",
    });
  }
  return issues;
}

function validateSingleIdentity(
  draft: SingleAssignmentDraft,
  issues: AssignmentDraftIssue[],
) {
  validateId(draft.studentId, "studentId", issues);
  validateId(draft.range.datasetId, "range.datasetId", issues);
  validateUniqueIds(draft.range.orderedUnitIds, "range.orderedUnitIds", issues);
  if (draft.operation.mode === "replace") {
    validateId(
      draft.operation.assignmentId,
      "operation.assignmentId",
      issues,
    );
    validateId(
      draft.operation.targetStudentId,
      "operation.targetStudentId",
      issues,
    );
    if (draft.studentId !== draft.operation.targetStudentId) {
      issues.push({
        code: "invalid_order",
        path: "studentId",
        message: "수정할 배정의 학생은 바꿀 수 없습니다.",
      });
    }
  }
}

function validateExactReviewProjectedLock(
  draft: SingleAssignmentDraft,
  issues: AssignmentDraftIssue[],
) {
  if (
    draft.operation.mode !== "replace" ||
    draft.operation.sourcePurpose !== "review"
  ) {
    return;
  }
  const locked = draft.operation.lockedShape;
  validateId(
    locked.datasetId,
    "operation.lockedShape.datasetId",
    issues,
  );
  validateUniqueIds(
    locked.orderedUnitIds,
    "operation.lockedShape.orderedUnitIds",
    issues,
  );
  validateReviewLevels(
    {
      mode: "pending",
      scope: locked.reviewScope,
      levels: locked.reviewLevels,
    },
    issues,
    "operation.lockedShape.reviewLevels",
  );
  const levels =
    draft.review.mode === "pending"
      ? [...draft.review.levels].toSorted()
      : [];
  if (
    draft.review.mode !== "pending" ||
    draft.review.scope !== locked.reviewScope ||
    draft.range.datasetId !== locked.datasetId ||
    !sameOrderedValues(draft.range.orderedUnitIds, locked.orderedUnitIds) ||
    !sameOrderedValues(levels, [...locked.reviewLevels].toSorted())
  ) {
    issues.push({
      code: "invalid_order",
      path: "operation.lockedShape",
      message: "오답 시험은 기존 대상 단어와 단계를 바꿀 수 없습니다.",
    });
  }
}

function validateExactReviewSubmissionLock(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
  issues: AssignmentDraftIssue[],
) {
  if (
    draft.operation.mode !== "replace" ||
    draft.operation.sourcePurpose !== "review"
  ) {
    return;
  }
  const lockedCount = draft.operation.lockedShape.questionCount;
  if (!integerInRange(lockedCount, 1, 500)) {
    issues.push({
      code: "out_of_range",
      path: "operation.lockedShape.questionCount",
      message: "잠긴 오답 시험 단어 수를 확인해 주세요.",
    });
  }
  if (
    draft.questionCount.mode !== "manual" ||
    draft.questionCount.value !== lockedCount ||
    resolved.questionCount !== lockedCount
  ) {
    issues.push({
      code: "invalid_order",
      path: "operation.lockedShape.questionCount",
      message: "오답 시험의 기존 단어 수를 바꿀 수 없습니다.",
    });
  }
}

export function validateSingleCapacityProjection(
  draft: SingleAssignmentDraft,
): AssignmentDraftIssue[] {
  const issues: AssignmentDraftIssue[] = [];
  validateSingleIdentity(draft, issues);
  validateDirection(draft.exam, issues);
  validateReviewLevels(draft.review, issues);
  validateExactReviewProjectedLock(draft, issues);
  return issues;
}

export function validateSingleAssignmentSubmission(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
  nowMilliseconds: number,
): AssignmentDraftIssue[] {
  const issues = validateSingleCapacityProjection(draft);
  validateExamSettings(draft.exam, issues);
  const availableFrom = availabilityIso(
    draft.availability,
    "availability",
    issues,
  );
  const deadline = deadlineIso(draft.deadline, "deadline", issues);
  if (deadline && Date.parse(deadline) <= nowMilliseconds) {
    issues.push({
      code: "invalid_order",
      path: "deadline",
      message: "응시 마감은 현재 시각보다 뒤로 정해 주세요.",
    });
  }
  if (
    availableFrom &&
    deadline &&
    Date.parse(deadline) <= Date.parse(availableFrom)
  ) {
    issues.push({
      code: "invalid_order",
      path: "deadline",
      message: "마감 시각은 공개 시각보다 뒤여야 합니다.",
    });
  }
  const minimum =
    draft.operation.mode === "replace" &&
    draft.operation.sourcePurpose === "review"
      ? 1
      : 4;
  if (!integerInRange(resolved.questionCount, minimum, 500)) {
    issues.push({
      code: "out_of_range",
      path: "questionCount",
      message: `단어 수는 ${minimum}개부터 500개까지 입력해 주세요.`,
    });
  }
  if (resolved.questionCount !== draft.questionCount.value) {
    issues.push({
      code: "invalid_order",
      path: "questionCount",
      message: "화면에 표시된 단어 수를 그대로 사용해 주세요.",
    });
  }
  if (draft.title.mode === "source" && draft.operation.mode === "create") {
    issues.push({
      code: "invalid_order",
      path: "title",
      message: "기존 시험 제목은 배정 수정에서만 사용할 수 있습니다.",
    });
  }
  if (
    draft.title.mode !== "automatic" &&
    (resolved.displayTitle !== draft.title.value ||
      resolved.submissionTitle !== draft.title.value)
  ) {
    issues.push({
      code: "invalid_order",
      path: "title",
      message: "선택한 시험 이름을 그대로 사용해 주세요.",
    });
  }
  if (
    draft.title.mode === "automatic" &&
    ((draft.operation.mode === "create" && resolved.submissionTitle !== "") ||
      (draft.operation.mode === "replace" &&
        resolved.submissionTitle !== resolved.displayTitle))
  ) {
    issues.push({
      code: "invalid_order",
      path: "title",
      message: "자동 시험 이름의 저장 방식을 확인해 주세요.",
    });
  }
  if (resolved.submissionTitle.trim().length > 160) {
    issues.push({
      code: "out_of_range",
      path: "title",
      message: "시험 이름은 160자 이하로 입력해 주세요.",
    });
  }
  if (
    draft.operation.mode === "replace" &&
    !resolved.submissionTitle.trim()
  ) {
    issues.push({
      code: "required",
      path: "title",
      message: "수정할 시험 이름을 입력해 주세요.",
    });
  }
  validateExactReviewSubmissionLock(draft, resolved, issues);
  return issues;
}

function validateCommonPlan(
  draft: BulkSeriesAssignmentDraft,
  issues: AssignmentDraftIssue[],
) {
  const plan = draft.commonPlan;
  if (!plan) {
    issues.push({
      code: "required",
      path: "commonPlan",
      message: "단어장, 범위, 날짜를 먼저 정해 주세요.",
    });
    return;
  }
  const immediate = plan.selectedDateCount === 0;
  const undatedUnitSplit = immediate &&
    plan.distribution === "split" &&
    plan.splitBasis === "range_unit";
  validateId(plan.datasetId, "commonPlan.datasetId", issues);
  validateId(plan.planNonce, "commonPlan.planNonce", issues);
  validateUniqueIds(plan.orderedUnitIds, "commonPlan.orderedUnitIds", issues);
  if (plan.splitBasis === "range_unit") {
    const rule = plan.unitAllocationRule;
    if (
      !rule ||
      rule.schemaVersion !== 1 ||
      !["same", "by_weekday"].includes(rule.mode) ||
      !integerInRange(rule.unitsPerSession, 1, 30) ||
      ISO_WEEKDAYS.some((weekday) =>
        !integerInRange(rule.weekdayUnitsPerSession[weekday], 1, 30)
      )
    ) {
      issues.push({
        code: "invalid_order",
        path: "commonPlan.unitAllocationMode",
        message: "회차별 범위 단위 규칙을 확인해 주세요.",
      });
    }
    const expectedRangeUnitCountLength = undatedUnitSplit
      ? 1
      : plan.selectedDateCount;
    if (
      plan.rangeUnitCounts.length !== expectedRangeUnitCountLength ||
      plan.rangeUnitCounts.some((count) => !integerInRange(count, 1, 30))
    ) {
      issues.push({
        code: "invalid_order",
        path: "commonPlan.rangeUnitCounts",
        message: "요일별 범위 단위 수와 선택한 날짜 수가 일치하지 않습니다.",
      });
    } else {
      if (
        !immediate &&
        rule &&
        plan.recurrenceSessions.length === plan.selectedDateCount &&
        JSON.stringify(resolveVocabUnitCountsForDates({
          dates: plan.recurrenceSessions.map((session) =>
            session.availableLocalDateTime?.slice(0, 10) ?? ""
          ),
          rule,
        })) !== JSON.stringify(plan.rangeUnitCounts)
      ) {
        issues.push({
          code: "invalid_order",
          path: "commonPlan.rangeUnitCounts",
          message: "요일별 단위 수가 원래 반복 일정의 규칙과 일치하지 않습니다.",
        });
      }
      const allocation = undatedUnitSplit && rule
        ? resolveUndatedVocabUnitCycleAllocation({
            orderedUnitIds: plan.orderedUnitIds,
            unitsPerSession: rule.unitsPerSession,
          })
        : resolveVocabUnitCycleAllocation({
            orderedUnitIds: plan.orderedUnitIds,
            baseSessionUnitCounts: plan.rangeUnitCounts,
            selectedDateCount: plan.selectedDateCount,
            overflowPolicy: plan.overflowPolicy,
            extraDatePolicy: plan.extraDatePolicy,
          });
      if (
        (undatedUnitSplit &&
          (rule?.mode !== "same" ||
            JSON.stringify(plan.rangeUnitCounts) !==
              JSON.stringify([rule?.unitsPerSession]))) ||
        allocation.issue ||
        JSON.stringify(allocation.sessionUnitIds) !==
          JSON.stringify(plan.sessions.map((session) => session.unitIds))
      ) {
        issues.push({
          code: "invalid_order",
          path: "commonPlan.sessions",
          message: "회차별 범위가 선택한 순서 또는 단위 수와 일치하지 않습니다.",
        });
      }
    }
  } else {
    if (plan.rangeUnitCounts.length > 0) {
      issues.push({
        code: "invalid_order",
        path: "commonPlan.rangeUnitCounts",
        message: "단어 수 기준에는 범위 단위 수를 함께 보낼 수 없습니다.",
      });
    }
    if (plan.unitAllocationRule !== null) {
      issues.push({
        code: "invalid_order",
        path: "commonPlan.unitAllocationMode",
        message: "단어 수 기준에는 범위 단위 규칙을 함께 보낼 수 없습니다.",
      });
    }
  }
  if (
    plan.splitBasis === "question_count" &&
    JSON.stringify(plan.sessions[0]?.unitIds ?? []) !==
      JSON.stringify(plan.orderedUnitIds)
  ) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.orderedUnitIds",
      message: "단어 수 기준의 전체 범위와 회차 범위가 일치하지 않습니다.",
    });
  }
  if (
    plan.questionCount.mode === "manual" &&
    !integerInRange(plan.questionCount.value, 4, 500)
  ) {
    issues.push({
      code: "out_of_range",
      path: "commonPlan.questionCount",
      message: "단어 수는 4개부터 500개까지 입력해 주세요.",
    });
  }
  if (
    plan.overflowPolicy === "continue_weekly" &&
    plan.distribution !== "split"
  ) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.overflowPolicy",
      message: "같은 요일로 이어서는 회차별 또는 단어 수 배정에서 선택할 수 있습니다.",
    });
  }
  if (plan.distribution !== "split" && plan.splitBasis === "range_unit") {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.splitBasis",
      message: "범위 단위 기준은 나누기에서만 사용할 수 있습니다.",
    });
  }
  if (
    !["unconfirmed", "repeat_from_start"].includes(
      plan.extraDatePolicy,
    )
  ) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.extraDatePolicy",
      message: "추가 날짜 처리 방법을 확인해 주세요.",
    });
  }
  if (!integerInRange(plan.selectedDateCount, 0, 7)) {
    issues.push({
      code: "out_of_range",
      path: "commonPlan.selectedDateCount",
      message: "선택한 날짜 수를 확인해 주세요.",
    });
  }
  if (
    immediate &&
    !(
      (plan.distribution === "repeat" &&
        plan.splitBasis === "question_count" &&
        plan.overflowPolicy === "leave" &&
        plan.sessions.length === 1 &&
        plan.recurrenceSessions.length === 1) ||
      (undatedUnitSplit &&
        plan.overflowPolicy === "leave" &&
        plan.extraDatePolicy === "unconfirmed" &&
        plan.recurrenceSessions.length === 1)
    )
  ) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.selectedDateCount",
      message: "시험일 없는 배정의 회차 구성을 확인해 주세요.",
    });
  }
  if (!["source_order", "random"].includes(plan.selectionMode)) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.selectionMode",
      message: "출제 단어 선택 방식을 골라 주세요.",
    });
  }
  if (
    plan.splitBasis === "question_count" &&
    plan.recurrenceSessions.length !== plan.sessions.length
  ) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.sessions",
      message: "원래 요일 반복 기준과 배정 회차 수가 일치하지 않습니다.",
    });
  }
  if (
    plan.splitBasis === "question_count" &&
    ((plan.selectedDateCount === 0 && plan.sessions.length !== 1) ||
      (plan.selectedDateCount > 0 &&
        plan.sessions.length !== plan.selectedDateCount))
  ) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.selectedDateCount",
      message: "선택한 날짜 수와 일정이 일치하지 않습니다.",
    });
  }
  if (
    plan.splitBasis === "range_unit" &&
    plan.selectedDateCount > 0 &&
    plan.recurrenceSessions.length !== plan.selectedDateCount
  ) {
    issues.push({
      code: "invalid_order",
      path: "commonPlan.sessions",
      message: "선택한 요일 수와 반복 일정 기준이 일치하지 않습니다.",
    });
  }
  if (!integerInRange(plan.sessions.length, 1, plan.splitBasis === "range_unit" ? 210 : 7)) {
    issues.push({
      code: "out_of_range",
      path: "commonPlan.sessions",
      message: `공통 배정은 한 번에 1회부터 ${plan.splitBasis === "range_unit" ? 210 : 7}회까지 만들 수 있습니다.`,
    });
  }
  let previousRecurrenceStart = Number.NEGATIVE_INFINITY;
  plan.recurrenceSessions.forEach((session, index) => {
    const start = session.availableLocalDateTime
      ? koreanDateTimeLocalToIso(session.availableLocalDateTime)
      : null;
    const deadline = session.deadlineLocalDateTime
      ? koreanDateTimeLocalToIso(session.deadlineLocalDateTime)
      : null;
    if (immediate) {
      if (
        session.availableLocalDateTime !== null ||
        session.deadlineLocalDateTime !== null
      ) {
        issues.push({
          code: "invalid_datetime",
          path: `commonPlan.recurrenceSessions.${index}`,
          message: "시험일 없는 배정에는 공개·마감 시각을 넣을 수 없습니다.",
        });
      }
      return;
    }
    if (!start || !deadline) {
      issues.push({
        code: "invalid_datetime",
        path: `commonPlan.recurrenceSessions.${index}`,
        message: "반복 일정의 공개·마감 시각을 확인해 주세요.",
      });
      return;
    }
    if (Date.parse(deadline) <= Date.parse(start)) {
      issues.push({
        code: "invalid_order",
        path: `commonPlan.recurrenceSessions.${index}.deadlineLocalDateTime`,
        message: "반복 일정 마감은 공개보다 뒤여야 합니다.",
      });
    }
    if (Date.parse(start) <= previousRecurrenceStart) {
      issues.push({
        code: "invalid_order",
        path: `commonPlan.recurrenceSessions.${index}.availableLocalDateTime`,
        message: "반복 일정 공개 시각은 앞 회차보다 뒤여야 합니다.",
      });
    }
    previousRecurrenceStart = Date.parse(start);
  });
  const commonUnitIds = JSON.stringify(plan.sessions[0]?.unitIds ?? []);
  const orderedUnitIdSet = new Set(plan.orderedUnitIds);
  let previousStart = Number.NEGATIVE_INFINITY;
  plan.sessions.forEach((session, index) => {
    validateUniqueIds(
      session.unitIds,
      `commonPlan.sessions.${index}.unitIds`,
      issues,
    );
    if (session.unitIds.some((unitId) => !orderedUnitIdSet.has(unitId))) {
      issues.push({
        code: "invalid_order",
        path: `commonPlan.sessions.${index}.unitIds`,
        message: "회차 범위가 선택한 전체 범위를 벗어났습니다.",
      });
    }
    if (
      plan.splitBasis === "question_count" &&
      JSON.stringify(session.unitIds) !== commonUnitIds
    ) {
      issues.push({
        code: "invalid_order",
        path: `commonPlan.sessions.${index}.unitIds`,
        message: "단어 수 배정은 모든 회차에서 같은 전체 범위를 사용해야 합니다.",
      });
    }
    const start = session.availableLocalDateTime
      ? koreanDateTimeLocalToIso(session.availableLocalDateTime)
      : null;
    const deadline = session.deadlineLocalDateTime
      ? koreanDateTimeLocalToIso(session.deadlineLocalDateTime)
      : null;
    if (
      immediate
        ? session.availableLocalDateTime !== null ||
          session.deadlineLocalDateTime !== null
        : !start || !deadline
    ) {
      issues.push({
        code: "invalid_datetime",
        path: `commonPlan.sessions.${index}`,
        message: immediate
          ? "시험일 없는 배정에는 마감을 넣을 수 없습니다."
          : `${index + 1}회차 공개·마감 시각을 확인해 주세요.`,
      });
      return;
    }
    if (start && deadline && Date.parse(deadline) <= Date.parse(start)) {
      issues.push({
        code: "invalid_order",
        path: `commonPlan.sessions.${index}.deadlineLocalDateTime`,
        message: `${index + 1}회차 마감은 공개보다 뒤여야 합니다.`,
      });
    }
    if (start && Date.parse(start) <= previousStart) {
      issues.push({
        code: "invalid_order",
        path: `commonPlan.sessions.${index}.availableLocalDateTime`,
        message: "회차 공개 시각은 앞 회차보다 뒤여야 합니다.",
      });
    }
    if (start) previousStart = Date.parse(start);
  });
}

export function validateBulkPreviewProjection(
  draft: BulkSeriesAssignmentDraft,
): AssignmentDraftIssue[] {
  const issues: AssignmentDraftIssue[] = [];
  validateUniqueIds(draft.studentIds, "studentIds", issues);
  if (draft.studentIds.length > MAXIMUM_BULK_STUDENT_COUNT) {
    issues.push({
      code: "out_of_range",
      path: "studentIds",
      message: `한 번에 최대 ${MAXIMUM_BULK_STUDENT_COUNT}명까지 선택할 수 있습니다.`,
    });
  }
  if (
    draft.commonPlan &&
    draft.studentIds.length * draft.commonPlan.sessions.length >
      MAXIMUM_BULK_ASSIGNMENT_COUNT
  ) {
    issues.push({
      code: "out_of_range",
      path: "commonPlan.sessions",
      message: `한 번에 저장할 수 있는 시험은 전체 ${MAXIMUM_BULK_ASSIGNMENT_COUNT}개까지입니다. 학생이나 회차를 줄여 주세요.`,
    });
  }
  validateCommonPlan(draft, issues);
  validateDirection(draft.exam, issues);
  if (draft.questionMode !== "book_meaning_choice") {
    if (draft.exam.directionRatio !== 0) {
      issues.push({
        code: "invalid_order",
        path: "exam.directionRatio",
        message: "영영풀이·예문 시험은 영어 단어 고르기로만 출제합니다.",
      });
    }
    const plan = draft.commonPlan;
    if (
      plan &&
      (plan.selectedDateCount !== 0 ||
        plan.distribution !== "repeat" ||
        plan.splitBasis !== "question_count" ||
        plan.sessions.length !== 1 ||
        plan.recurrenceSessions.length !== 1 ||
        plan.sessions.some((session) =>
          session.availableLocalDateTime !== null ||
          session.deadlineLocalDateTime !== null
        ) ||
        plan.recurrenceSessions.some((session) =>
          session.availableLocalDateTime !== null ||
          session.deadlineLocalDateTime !== null
        ))
    ) {
      issues.push({
        code: "invalid_order",
        path: "commonPlan.selectedDateCount",
        message: "영영풀이·예문 시험은 Preview에서 시험일 없이 1회만 바로 배정할 수 있습니다.",
      });
    }
  }
  return issues;
}

export function validateBulkAssignmentSubmission(
  draft: BulkSeriesAssignmentDraft,
  nowMilliseconds: number,
): AssignmentDraftIssue[] {
  const issues = validateBulkPreviewProjection(draft);
  validateExamSettings(draft.exam, issues);
  draft.commonPlan?.sessions.forEach((session, index) => {
    const deadline = session.deadlineLocalDateTime
      ? koreanDateTimeLocalToIso(session.deadlineLocalDateTime)
      : null;
    if (deadline && Date.parse(deadline) <= nowMilliseconds) {
      issues.push({
        code: "invalid_order",
        path: `commonPlan.sessions.${index}.deadlineLocalDateTime`,
        message: `${index + 1}회차 마감은 현재 시각보다 뒤로 정해 주세요.`,
      });
    }
  });
  return issues;
}

export function validateLegacyReviewRecoveryDraft(
  draft: LegacyReviewRecoveryDraft,
): AssignmentDraftIssue[] {
  const issues: AssignmentDraftIssue[] = [];
  validateId(draft.studentId, "studentId", issues);
  validateId(draft.reviewDraftId, "reviewDraftId", issues);
  return issues;
}

export function validateAssignmentDraft(
  draft: AssignmentDraft,
): AssignmentDraftIssue[] {
  if (draft.kind === "single") return validateSingleCapacityProjection(draft);
  if (draft.kind === "bulk_series") return validateBulkPreviewProjection(draft);
  return validateLegacyReviewRecoveryDraft(draft);
}

function assertNoIssues(issues: AssignmentDraftIssue[]) {
  if (issues.length > 0) throw new InvalidAssignmentDraftError(issues);
}

export function assertValidAssignmentDraft(draft: AssignmentDraft): void {
  assertNoIssues(validateAssignmentDraft(draft));
}

export function assertValidSingleCapacityProjection(
  draft: SingleAssignmentDraft,
): void {
  assertNoIssues(validateSingleCapacityProjection(draft));
}

export function assertValidSingleAssignmentSubmission(
  draft: SingleAssignmentDraft,
  resolved: ResolvedSingleAssignment,
  nowMilliseconds: number,
): void {
  assertNoIssues(
    validateSingleAssignmentSubmission(draft, resolved, nowMilliseconds),
  );
}

export function assertValidBulkPreviewProjection(
  draft: BulkSeriesAssignmentDraft,
): void {
  assertNoIssues(validateBulkPreviewProjection(draft));
}

export function assertValidBulkAssignmentSubmission(
  draft: BulkSeriesAssignmentDraft,
  nowMilliseconds: number,
): void {
  assertNoIssues(validateBulkAssignmentSubmission(draft, nowMilliseconds));
}
