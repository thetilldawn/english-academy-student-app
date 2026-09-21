import { z } from "zod";

export const directReviewUnavailableItemSchema = z.object({
  sourceQuestionId: z.uuid(), vocabEntryId: z.number().int().positive(),
  headword: z.string(), primaryMeaning: z.string().nullable(),
  reason: z.enum(["target_unavailable", "identity_changed", "direction_unavailable", "insufficient_choices"]),
}).strict();
export type DirectReviewUnavailableItem = z.infer<typeof directReviewUnavailableItemSchema>;
