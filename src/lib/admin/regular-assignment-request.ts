import { z } from "zod";

import { questionOrderModes } from "@/lib/admin/assignment-settings";

import {
  timingSettingsSchema,
  validateRetrySettings,
} from "./assignment-request-common";

export const assignmentSchema = z
  .object({
    title: z.string().trim().max(160).default(""),
    datasetId: z.uuid(),
    unitIds: z.array(z.uuid()).min(1),
    questionCount: z.coerce.number().int().min(4).max(500),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
    timeLimitSeconds: z.coerce.number().int().min(30).max(10800),
    passingScore: z.coerce.number().int().min(0).max(100),
    retryEnabled: z.boolean(),
    retryPassingScore: z.coerce.number().int().min(0).max(100).nullable(),
    questionOrderMode: z.enum(questionOrderModes).default("random"),
    availableUntil: z
      .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
    studentIds: z.array(z.uuid()).min(1),
  })
  .and(timingSettingsSchema)
  .refine(
    (value) => new Set(value.unitIds).size === value.unitIds.length,
    {
      message: "같은 범위를 두 번 선택할 수 없습니다.",
      path: ["unitIds"],
    },
  )
  .superRefine(validateRetrySettings);

export type AssignmentInput = z.infer<typeof assignmentSchema>;
