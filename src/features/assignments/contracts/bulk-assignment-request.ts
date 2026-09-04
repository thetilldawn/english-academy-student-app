import { z } from "zod";

import { resolveVocabUnitCountsForDates } from "@/lib/admin/vocab-unit-allocation";
import {
  resolveUndatedVocabUnitCycleAllocation,
  resolveVocabUnitCycleAllocation,
} from "@/features/assignments/domain/vocab-unit-allocation";
import {
  questionOrderModes,
  timingModes,
} from "@/lib/admin/assignment-settings";
import {
  assignmentQuestionModes,
  MAXIMUM_BULK_ASSIGNMENT_COUNT,
  MAXIMUM_BULK_STUDENT_COUNT,
} from "@/features/assignments/domain/model";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

const vocabUnitCountSchema = z.number().int().min(1).max(30);
const vocabUnitAllocationRuleSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["same", "by_weekday"]),
    unitsPerSession: vocabUnitCountSchema,
    weekdayUnitsPerSession: z
      .object({
        1: vocabUnitCountSchema,
        2: vocabUnitCountSchema,
        3: vocabUnitCountSchema,
        4: vocabUnitCountSchema,
        5: vocabUnitCountSchema,
        6: vocabUnitCountSchema,
        7: vocabUnitCountSchema,
      })
      .strict(),
  })
  .strict();

const bulkCommonPlanSchema = z
  .object({
    datasetId: z.uuid(),
    distribution: z.enum(["split", "repeat"]),
    splitBasis: z.enum(["question_count", "range_unit"]),
    orderedUnitIds: z.array(z.uuid()).min(1).max(500),
    rangeUnitCounts: z.array(z.number().int().min(1).max(30)).max(7),
    unitAllocationRule: vocabUnitAllocationRuleSchema.nullable(),
    questionCount: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("all") }).strict(),
      z
        .object({
          mode: z.literal("manual"),
          value: z.number().int().min(4).max(500),
        })
        .strict(),
    ]),
    overflowPolicy: z.enum(["leave", "continue_weekly"]),
    extraDatePolicy: z.enum(["unconfirmed", "repeat_from_start"]),
    selectedDateCount: z.number().int().min(0).max(7),
    selectionMode: z.enum(["source_order", "random"]),
    planNonce: z.uuid(),
    recurrenceSessions: z
      .array(
        z
          .object({
            availableFrom: z.iso.datetime({ offset: true }).nullable(),
            availableUntil: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(7),
    sessions: z
      .array(
        z
          .object({
            unitIds: z.array(z.uuid()).min(1).max(500),
            availableFrom: z.iso.datetime({ offset: true }).nullable(),
            availableUntil: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(210),
  })
  .strict()
  .superRefine((value, context) => {
    const immediate = value.selectedDateCount === 0;
    const undatedUnitSplit = immediate &&
      value.distribution === "split" &&
      value.splitBasis === "range_unit";
    if (
      immediate &&
      !(
        (value.distribution === "repeat" &&
          value.splitBasis === "question_count" &&
          value.overflowPolicy === "leave" &&
          value.sessions.length === 1 &&
          value.recurrenceSessions.length === 1) ||
        (undatedUnitSplit &&
          value.overflowPolicy === "leave" &&
          value.extraDatePolicy === "unconfirmed" &&
          value.recurrenceSessions.length === 1)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedDateCount"],
        message: "시험일 없는 배정의 회차 구성을 확인해 주세요.",
      });
    }
    if (
      value.distribution !== "split" &&
      value.overflowPolicy === "continue_weekly"
    ) {
      context.addIssue({
        code: "custom",
        path: ["overflowPolicy"],
        message: "같은 요일로 이어서는 나누기에서만 사용할 수 있습니다.",
      });
    }
    if (
      value.splitBasis === "question_count" &&
      value.questionCount.mode !== "manual" &&
      value.overflowPolicy === "continue_weekly"
    ) {
      context.addIssue({
        code: "custom",
        path: ["overflowPolicy"],
        message: "단어 수 기준은 직접 입력한 단어 수가 있을 때만 다음 주로 이어갈 수 있습니다.",
      });
    }
    if (
      value.distribution !== "split" &&
      value.splitBasis === "range_unit"
    ) {
      context.addIssue({
        code: "custom",
        path: ["splitBasis"],
        message: "범위 단위 기준은 나누기에서만 사용할 수 있습니다.",
      });
    }
    if (
      value.splitBasis === "range_unit" &&
      value.rangeUnitCounts.length !== (undatedUnitSplit
        ? 1
        : value.selectedDateCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rangeUnitCounts"],
        message: "요일별 범위 단위 수와 선택한 날짜 수가 일치하지 않습니다.",
      });
    }
    if (
      value.splitBasis === "range_unit" &&
      value.unitAllocationRule === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["unitAllocationRule"],
        message: "회차별 범위 단위 규칙을 확인해 주세요.",
      });
    }
    if (
      value.splitBasis === "question_count" &&
      value.rangeUnitCounts.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["rangeUnitCounts"],
        message: "단어 수 기준에는 범위 단위 수를 함께 보낼 수 없습니다.",
      });
    }
    if (
      value.splitBasis === "question_count" &&
      value.unitAllocationRule !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["unitAllocationRule"],
        message: "단어 수 기준에는 범위 단위 규칙을 함께 보낼 수 없습니다.",
      });
    }
    if (
      value.splitBasis === "question_count" &&
      value.recurrenceSessions.length !== value.sessions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["recurrenceSessions"],
        message: "반복 일정 기준과 배정 회차 수가 일치하지 않습니다.",
      });
    }
    if (
      value.splitBasis === "question_count" &&
      ((value.selectedDateCount === 0 && value.sessions.length !== 1) ||
        (value.selectedDateCount > 0 &&
          value.sessions.length !== value.selectedDateCount))
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedDateCount"],
        message: "선택한 날짜 수와 일정이 일치하지 않습니다.",
      });
    }
    if (
      value.splitBasis === "range_unit" &&
      value.selectedDateCount > 0 &&
      value.recurrenceSessions.length !== value.selectedDateCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["recurrenceSessions"],
        message: "선택한 요일 수와 반복 일정 기준이 일치하지 않습니다.",
      });
    }
    let previousRecurrenceStart = Number.NEGATIVE_INFINITY;
    value.recurrenceSessions.forEach((session, index) => {
      if (immediate) {
        if (session.availableFrom !== null || session.availableUntil !== null) {
          context.addIssue({
            code: "custom",
            path: ["recurrenceSessions", index],
            message: "시험일 없는 배정에는 공개·마감 시각을 넣을 수 없습니다.",
          });
        }
        return;
      }
      if (!session.availableFrom || !session.availableUntil) {
        context.addIssue({
          code: "custom",
          path: ["recurrenceSessions", index],
          message: "반복 일정의 공개·마감 시각을 입력해 주세요.",
        });
        return;
      }
      const start = Date.parse(session.availableFrom);
      if (Date.parse(session.availableUntil) <= start) {
        context.addIssue({
          code: "custom",
          path: ["recurrenceSessions", index, "availableUntil"],
          message: "반복 일정 마감은 공개보다 뒤여야 합니다.",
        });
      }
      if (start <= previousRecurrenceStart) {
        context.addIssue({
          code: "custom",
          path: ["recurrenceSessions", index, "availableFrom"],
          message: "반복 일정 공개 시각은 앞 회차보다 뒤여야 합니다.",
        });
      }
      previousRecurrenceStart = start;
    });
    if (new Set(value.orderedUnitIds).size !== value.orderedUnitIds.length) {
      context.addIssue({
        code: "custom",
        path: ["orderedUnitIds"],
        message: "선택한 전체 범위에 같은 단위를 두 번 넣을 수 없습니다.",
      });
    }
    if (
      value.splitBasis === "question_count" &&
      JSON.stringify(value.sessions[0]?.unitIds ?? []) !==
        JSON.stringify(value.orderedUnitIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["orderedUnitIds"],
        message: "단어 수 기준의 전체 범위와 회차 범위가 일치하지 않습니다.",
      });
    }
    if (
      value.splitBasis === "range_unit" &&
      !immediate &&
      value.unitAllocationRule &&
      value.recurrenceSessions.length === value.selectedDateCount
    ) {
      const recurrenceDates = value.recurrenceSessions.flatMap((session) =>
        session.availableFrom
          ? [isoToKoreanDateTimeLocal(session.availableFrom).slice(0, 10)]
          : []
      );
      const expectedCounts = resolveVocabUnitCountsForDates({
        dates: recurrenceDates,
        rule: value.unitAllocationRule,
      });
      if (
        recurrenceDates.length !== value.recurrenceSessions.length ||
        JSON.stringify(expectedCounts) !==
          JSON.stringify(value.rangeUnitCounts)
      ) {
        context.addIssue({
          code: "custom",
          path: ["rangeUnitCounts"],
          message: "요일별 단위 수가 원래 반복 일정의 규칙과 일치하지 않습니다.",
        });
      }
    }
    if (
      value.splitBasis === "range_unit" &&
      value.rangeUnitCounts.length === (undatedUnitSplit
        ? 1
        : value.selectedDateCount)
    ) {
      const rule = value.unitAllocationRule;
      const allocation = undatedUnitSplit && rule
        ? resolveUndatedVocabUnitCycleAllocation({
            orderedUnitIds: value.orderedUnitIds,
            unitsPerSession: rule.unitsPerSession,
          })
        : resolveVocabUnitCycleAllocation({
            orderedUnitIds: value.orderedUnitIds,
            baseSessionUnitCounts: value.rangeUnitCounts,
            selectedDateCount: value.selectedDateCount,
            overflowPolicy: value.overflowPolicy,
            extraDatePolicy: value.extraDatePolicy,
          });
      if (
        (undatedUnitSplit &&
          (rule?.mode !== "same" ||
            JSON.stringify(value.rangeUnitCounts) !==
              JSON.stringify([rule?.unitsPerSession]))) ||
        allocation.issue ||
        JSON.stringify(allocation.sessionUnitIds) !==
          JSON.stringify(value.sessions.map((session) => session.unitIds))
      ) {
        context.addIssue({
          code: "custom",
          path: ["sessions"],
          message: "회차별 범위가 선택한 순서 또는 단위 수와 일치하지 않습니다.",
        });
      }
    }
  });

const bulkAssignmentSelectionFields = {
  studentIds: z.array(z.uuid()).min(1).max(MAXIMUM_BULK_STUDENT_COUNT),
  questionMode: z.enum(assignmentQuestionModes).default("book_meaning_choice"),
  englishToKoreanRatio: z.union([
    z.literal(0),
    z.literal(50),
    z.literal(100),
  ]),
  commonPlan: bulkCommonPlanSchema,
} as const;

function validateBulkAssignmentSelection(
  value: {
    studentIds: string[];
    questionMode: (typeof assignmentQuestionModes)[number];
    englishToKoreanRatio: 0 | 50 | 100;
    commonPlan: z.infer<typeof bulkCommonPlanSchema>;
  },
  context: z.RefinementCtx,
) {
  if (value.questionMode !== "book_meaning_choice") {
    if (value.englishToKoreanRatio !== 0) {
      context.addIssue({
        code: "custom",
        path: ["englishToKoreanRatio"],
        message: "영영풀이·예문 시험은 영어 단어 고르기로만 출제합니다.",
      });
    }
    const plan = value.commonPlan;
    if (
      plan.selectedDateCount !== 0 ||
      plan.distribution !== "repeat" ||
      plan.splitBasis !== "question_count" ||
      plan.sessions.length !== 1 ||
      plan.recurrenceSessions.length !== 1 ||
      plan.sessions.some((session) =>
        session.availableFrom !== null || session.availableUntil !== null
      ) ||
      plan.recurrenceSessions.some((session) =>
        session.availableFrom !== null || session.availableUntil !== null
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["commonPlan", "selectedDateCount"],
        message: "영영풀이·예문 시험은 Preview에서 시험일 없이 1회만 바로 배정할 수 있습니다.",
      });
    }
  }
  if (
    value.studentIds.length * value.commonPlan.sessions.length >
      MAXIMUM_BULK_ASSIGNMENT_COUNT
  ) {
    context.addIssue({
      code: "custom",
      path: ["commonPlan", "sessions"],
      message: `한 번에 저장할 수 있는 시험은 전체 ${MAXIMUM_BULK_ASSIGNMENT_COUNT}개까지입니다. 학생이나 회차를 줄여 주세요.`,
    });
  }
  if (new Set(value.studentIds).size !== value.studentIds.length) {
    context.addIssue({
      code: "custom",
      path: ["studentIds"],
      message: "같은 학생을 두 번 선택할 수 없습니다.",
    });
  }
  {
    const commonPlan = value.commonPlan;
    if (commonPlan.sessions.length === 0) return;
    const commonUnitIds = JSON.stringify(
      commonPlan.sessions[0]?.unitIds ?? [],
    );
    const orderedUnitIdSet = new Set(commonPlan.orderedUnitIds);
    let previousStart = Number.NEGATIVE_INFINITY;
    commonPlan.sessions.forEach((session, index) => {
      if (new Set(session.unitIds).size !== session.unitIds.length) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "unitIds"],
          message: "같은 범위를 한 회차에 두 번 넣을 수 없습니다.",
        });
      }
      if (session.unitIds.some((unitId) => !orderedUnitIdSet.has(unitId))) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "unitIds"],
          message: "회차 범위가 선택한 전체 범위를 벗어났습니다.",
        });
      }
      if (
        commonPlan.splitBasis === "question_count" &&
        JSON.stringify(session.unitIds) !== commonUnitIds
      ) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "unitIds"],
          message: "단어 수 배정은 모든 회차에서 같은 전체 범위를 사용해야 합니다.",
        });
      }
      if (commonPlan.selectedDateCount === 0) {
        if (session.availableFrom !== null || session.availableUntil !== null) {
          context.addIssue({
            code: "custom",
            path: ["commonPlan", "sessions", index],
            message: "시험일 없는 배정에는 공개·마감 시각을 넣을 수 없습니다.",
          });
        }
        return;
      }
      if (!session.availableFrom || !session.availableUntil) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index],
          message: "회차 공개·마감 시각을 입력해 주세요.",
        });
        return;
      }
      const start = Date.parse(session.availableFrom);
      if (Date.parse(session.availableUntil) <= start) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "availableUntil"],
          message: "회차 마감은 공개보다 뒤여야 합니다.",
        });
      }
      if (start <= previousStart) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "availableFrom"],
          message: "회차 공개 시각은 앞 회차보다 뒤여야 합니다.",
        });
      }
      previousStart = start;
    });
  }
}

export const bulkAssignmentPreviewSchema = z
  .object(bulkAssignmentSelectionFields)
  .strict()
  .superRefine(validateBulkAssignmentSelection);

export const bulkAssignmentSchema = z
  .object({
    ...bulkAssignmentSelectionFields,
    idempotencyKey: z.uuid(),
    previewPlanSignature: z.string().regex(/^[0-9a-f]{64}$/),
    timeLimitSeconds: z.number().int().min(30).max(10800),
    passingScore: z.number().int().min(0).max(100),
    retryEnabled: z.boolean(),
    retryPassingScore: z.number().int().min(0).max(100).nullable(),
    questionOrderMode: z.enum(questionOrderModes).default("random"),
    timingMode: z.enum(timingModes),
    questionTimeLimitSeconds: z
      .number()
      .int()
      .min(5)
      .max(600)
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    validateBulkAssignmentSelection(value, context);
    if (value.retryEnabled !== (value.retryPassingScore !== null)) {
      context.addIssue({
        code: "custom",
        path: ["retryPassingScore"],
        message: "재시험 사용 여부와 통과 점수를 확인해 주세요.",
      });
    }
    if (
      (value.timingMode === "none" &&
        value.questionTimeLimitSeconds !== null) ||
      (value.timingMode === "total" &&
        value.questionTimeLimitSeconds !== null) ||
      (value.timingMode === "per_question" &&
        value.questionTimeLimitSeconds === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["questionTimeLimitSeconds"],
        message: "시간 제한 방식과 문제당 시간을 확인해주세요.",
      });
    }
  });

export type BulkAssignmentPreviewInput = z.infer<
  typeof bulkAssignmentPreviewSchema
>;

export type BulkAssignmentInput = z.infer<
  typeof bulkAssignmentSchema
>;
