import { z } from "zod";

import { resolveVocabUnitCycleAllocation } from "@/features/assignments/domain/vocab-unit-allocation";
import {
  questionOrderModes,
  timingModes,
} from "@/lib/admin/assignment-settings";
import {
  bulkAssignmentRangeModes,
  MAXIMUM_BULK_ASSIGNMENT_COUNT,
  MAXIMUM_BULK_STUDENT_COUNT,
} from "@/lib/admin/bulk-assignment-range";

import { reviewLevelSchema } from "./assignment-request-common";

const bulkCollisionDecisionSchema = z
  .object({
    collisionId: z.string().trim().min(1).max(240),
    mode: z.enum(["skip", "move", "allow"]),
    movedAvailableFrom: z.iso.datetime({ offset: true }).nullable(),
    movedAvailableUntil: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "move") {
      if (
        !value.movedAvailableFrom ||
        !value.movedAvailableUntil ||
        Date.parse(value.movedAvailableUntil) <=
          Date.parse(value.movedAvailableFrom)
      ) {
        context.addIssue({
          code: "custom",
          path: ["movedAvailableUntil"],
          message: "이동할 시험의 공개·마감 시각을 확인해 주세요.",
        });
      }
    } else if (value.movedAvailableFrom || value.movedAvailableUntil) {
      context.addIssue({
        code: "custom",
        path: ["movedAvailableFrom"],
        message: "이동을 선택했을 때만 이동 시각을 보낼 수 있습니다.",
      });
    }
  });

const bulkCommonPlanSchema = z
  .object({
    datasetId: z.uuid(),
    distribution: z.enum(["split", "repeat"]),
    splitBasis: z.enum(["question_count", "range_unit"]),
    orderedUnitIds: z.array(z.uuid()).min(1).max(500),
    rangeUnitCounts: z.array(z.number().int().min(1).max(30)).max(7),
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
            availableFrom: z.iso.datetime({ offset: true }),
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
            availableFrom: z.iso.datetime({ offset: true }),
            availableUntil: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(210),
    collisionDecisions: z.array(bulkCollisionDecisionSchema).max(210),
  })
  .strict()
  .superRefine((value, context) => {
    const immediate = value.selectedDateCount === 0;
    if (
      immediate &&
      (value.distribution !== "repeat" ||
        value.splitBasis !== "question_count" ||
        value.overflowPolicy !== "leave" ||
        value.sessions.length !== 1 ||
        value.recurrenceSessions.length !== 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedDateCount"],
        message: "시험일 없는 배정은 한 번만 바로 배정할 수 있습니다.",
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
        message: "문항 수 기준은 직접 입력한 문항 수가 있을 때만 다음 주로 이어갈 수 있습니다.",
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
      value.rangeUnitCounts.length !== value.selectedDateCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["rangeUnitCounts"],
        message: "요일별 범위 단위 수와 선택한 날짜 수가 일치하지 않습니다.",
      });
    }
    if (
      value.splitBasis === "question_count" &&
      value.rangeUnitCounts.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["rangeUnitCounts"],
        message: "문항 수 기준에는 범위 단위 수를 함께 보낼 수 없습니다.",
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
      const start = Date.parse(session.availableFrom);
      if (
        immediate
          ? session.availableUntil !== null
          : session.availableUntil === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["recurrenceSessions", index, "availableUntil"],
          message: immediate
            ? "시험일 없는 배정에는 마감을 넣을 수 없습니다."
            : "반복 일정 마감을 입력해 주세요.",
        });
      } else if (
        session.availableUntil &&
        Date.parse(session.availableUntil) <= start
      ) {
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
        message: "문항 수 기준의 전체 범위와 회차 범위가 일치하지 않습니다.",
      });
    }
    if (
      value.splitBasis === "range_unit" &&
      value.rangeUnitCounts.length === value.selectedDateCount
    ) {
      const allocation = resolveVocabUnitCycleAllocation({
        orderedUnitIds: value.orderedUnitIds,
        baseSessionUnitCounts: value.rangeUnitCounts,
        selectedDateCount: value.selectedDateCount,
        overflowPolicy: value.overflowPolicy,
        extraDatePolicy: value.extraDatePolicy,
      });
      if (
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
  rangeMode: z.enum(bulkAssignmentRangeModes).default("previous_span"),
  unitsPerSession: z.number().int().min(1).max(30).default(1),
  sessionCount: z.number().int().min(1).max(210).default(1),
  firstAvailableFrom: z.iso.datetime({ offset: true }),
  dayInterval: z.number().int().min(1).max(30).default(1),
  firstAvailableUntil: z.iso.datetime({ offset: true }).nullable(),
  includePendingReview: z.boolean(),
  reviewLevels: z.array(reviewLevelSchema).min(1).max(2),
  englishToKoreanRatio: z.union([
    z.literal(0),
    z.literal(50),
    z.literal(100),
  ]),
  commonPlan: bulkCommonPlanSchema.optional(),
} as const;

function validateBulkAssignmentSelection(
  value: {
    studentIds: string[];
    reviewLevels: (1 | 2)[];
    firstAvailableFrom: string;
    firstAvailableUntil: string | null;
    sessionCount: number;
    includePendingReview: boolean;
    commonPlan?: z.infer<typeof bulkCommonPlanSchema>;
  },
  context: z.RefinementCtx,
) {
  const maximumSessionCount = value.commonPlan?.splitBasis === "range_unit"
    ? 210
    : 7;
  if (value.sessionCount > maximumSessionCount) {
    context.addIssue({
      code: "custom",
      path: ["sessionCount"],
      message: `시험 횟수는 1회부터 ${maximumSessionCount}회까지 설정해 주세요.`,
    });
  }
  if (
    value.commonPlan &&
    value.studentIds.length * value.commonPlan.sessions.length >
      MAXIMUM_BULK_ASSIGNMENT_COUNT
  ) {
    context.addIssue({
      code: "custom",
      path: ["sessionCount"],
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
  if (new Set(value.reviewLevels).size !== value.reviewLevels.length) {
    context.addIssue({
      code: "custom",
      path: ["reviewLevels"],
      message: "같은 오답 단계를 두 번 선택할 수 없습니다.",
    });
  }
  if (
    value.firstAvailableUntil &&
    Date.parse(value.firstAvailableUntil) <= Date.parse(value.firstAvailableFrom)
  ) {
    context.addIssue({
      code: "custom",
      path: ["firstAvailableUntil"],
      message: "첫 시험 마감은 첫 배정 시간보다 뒤로 정해 주세요.",
    });
  }
  if (value.commonPlan) {
    const commonPlan = value.commonPlan;
    if (value.includePendingReview) {
      context.addIssue({
        code: "custom",
        path: ["includePendingReview"],
        message: "공통 단어 배정에서는 오답을 함께 넣을 수 없습니다.",
      });
    }
    if (commonPlan.sessions.length !== value.sessionCount) {
      context.addIssue({
        code: "custom",
        path: ["commonPlan", "sessions"],
        message: "공통 배정 회차와 시험 횟수가 일치하지 않습니다.",
      });
    }
    if (commonPlan.sessions.length === 0) return;
    if (
      new Set(
        commonPlan.collisionDecisions.map((item) => item.collisionId),
      ).size !== commonPlan.collisionDecisions.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["commonPlan", "collisionDecisions"],
        message: "같은 겹침 결정을 두 번 보낼 수 없습니다.",
      });
    }
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
          message: "문항 나누기는 모든 회차에서 같은 전체 범위를 사용해야 합니다.",
        });
      }
      if (
        commonPlan.selectedDateCount === 0
          ? session.availableUntil !== null
          : session.availableUntil === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "availableUntil"],
          message: commonPlan.selectedDateCount === 0
            ? "시험일 없는 배정에는 마감을 넣을 수 없습니다."
            : "회차 마감을 입력해 주세요.",
        });
      } else if (
        session.availableUntil &&
        Date.parse(session.availableUntil) <= Date.parse(session.availableFrom)
      ) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "availableUntil"],
          message: "회차 마감은 공개보다 뒤여야 합니다.",
        });
      }
      if (Date.parse(session.availableFrom) <= previousStart) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "availableFrom"],
          message: "회차 공개 시각은 앞 회차보다 뒤여야 합니다.",
        });
      }
      previousStart = Date.parse(session.availableFrom);
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
