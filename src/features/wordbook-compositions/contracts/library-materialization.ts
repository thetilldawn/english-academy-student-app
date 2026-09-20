import { z } from "zod";
import { libraryHashSchema } from "./library";
import { libraryResourceSchema } from "./library-resources";

export const materializeLibrarySchema = z.object({
  action: z.literal("materialize"), versionId: z.uuid(), contentHash: libraryHashSchema,
}).strict();
const direction = z.enum(["english_to_korean", "korean_to_english"]);
export const compositionPreparationSchema = z.object({
  versionId: z.uuid(), datasetId: z.uuid(), contentHash: libraryHashSchema, state: z.enum(["preparing", "ready"]),
  entries: z.array(z.object({
    id: z.number().int().positive().safe(), unitId: z.uuid(), sourceRow: z.number().int().positive(),
    headword: z.string().min(1), primaryMeaning: z.string().min(1),
    sourceKind: z.enum(["legacy_vocab", "exam_use", "reviewed_exam"]), sourceEntryId: z.number().int().positive().safe(),
    eligibleDirections: z.array(direction).max(2), compositionTargetKey: libraryHashSchema, resources: libraryResourceSchema,
  }).strict()).min(1).max(20000),
}).strict().refine(p => new Set(p.entries.map(e => e.id)).size === p.entries.length);
export type CompositionPreparation = z.infer<typeof compositionPreparationSchema>;
