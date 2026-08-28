import { z } from "zod";

import type {
  VocabSplitOverflowPolicy,
  VocabUnitAllocationRuleV1,
} from "./vocab-unit-allocation";

export const storedVocabUnitAllocationRuleSchema = z.object({
  schema_version: z.literal(1),
  mode: z.enum(["same", "by_weekday"]),
  units_per_session: z.number().int().min(1).max(30),
  weekday_units_per_session: z.array(z.object({
    isodow: z.number().int().min(1).max(7),
    unit_count: z.number().int().min(1).max(30),
  }).strict()).length(7),
  overflow_policy: z.enum(["leave", "continue_weekly"]),
}).passthrough().superRefine((rule, context) => {
  if (new Set(rule.weekday_units_per_session.map((item) => item.isodow)).size !== 7) {
    context.addIssue({
      code: "custom",
      message: "요일별 단위 규칙이 중복되었습니다.",
    });
  }
});

export type VocabUnitAllocationRuleRecord = {
  rule: VocabUnitAllocationRuleV1;
  overflowPolicy: VocabSplitOverflowPolicy;
};

export function decodeStoredVocabUnitAllocationRule(
  value: unknown,
): VocabUnitAllocationRuleRecord | null {
  const parsed = storedVocabUnitAllocationRuleSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    rule: {
      schemaVersion: 1,
      mode: parsed.data.mode,
      unitsPerSession: parsed.data.units_per_session,
      weekdayUnitsPerSession: Object.fromEntries(
        parsed.data.weekday_units_per_session.map((item) => [
          item.isodow,
          item.unit_count,
        ]),
      ) as VocabUnitAllocationRuleRecord["rule"]["weekdayUnitsPerSession"],
    },
    overflowPolicy: parsed.data.overflow_policy,
  };
}
