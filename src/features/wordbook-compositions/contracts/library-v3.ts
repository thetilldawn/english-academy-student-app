import { z } from "zod";
import { TEMPLATE_KINDS } from "@/lib/admin/dataset-catalog";
import { createdLibraryBookSchema } from "./library";
import { libraryCommandV2Schema, libraryCommandV2ResultSchema } from "./library-command-v2";
import { libraryTemplateSummarySchema, libraryDetailSchema, libraryQueryResultSchema } from "./library-query";

export const templateKindSchema = z.enum(TEMPLATE_KINDS);
export const templateKindFilterSchema = z.enum(["all", "unclassified", ...TEMPLATE_KINDS]);
export type TemplateKind = z.infer<typeof templateKindSchema>;
export type TemplateKindFilter = z.infer<typeof templateKindFilterSchema>;
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  performance_assessment: "수행평가", exam_prep: "직전대비", mock_exam: "모의고사", other: "기타",
};
export const templateKindLabel = (kind: TemplateKind | null) => kind ? TEMPLATE_KIND_LABELS[kind] : "분류 확인";

// Legacy request and receipt shapes stay strict and unchanged.
export const libraryCommandV3Schema = z.discriminatedUnion("action", [
  libraryCommandV2Schema.options[0].extend({ protocolVersion: z.literal(3), templateKind: templateKindSchema }),
  libraryCommandV2Schema.options[1].extend({ protocolVersion: z.literal(3), templateKind: templateKindSchema.nullable() }),
  libraryCommandV2Schema.options[2].extend({ protocolVersion: z.literal(3), templateKind: templateKindSchema.nullable() }),
  libraryCommandV2Schema.options[3].extend({ protocolVersion: z.literal(3), templateKind: templateKindSchema }),
  libraryCommandV2Schema.options[4].extend({ protocolVersion: z.literal(3) }),
]);
export type LibraryCommandV3 = z.infer<typeof libraryCommandV3Schema>;
export const libraryWriteCommandSchema = z.union([libraryCommandV3Schema, libraryCommandV2Schema]);
export type LibraryWriteCommand = z.infer<typeof libraryWriteCommandSchema>;

export const classifiedTemplateSummarySchema = libraryTemplateSummarySchema.extend({ templateKind: templateKindSchema.nullable() });
export const classifiedCreatedBookSchema = createdLibraryBookSchema.extend({
  dataset: createdLibraryBookSchema.shape.dataset.extend({ templateKind: templateKindSchema.nullable() }),
});
export const libraryCommandV3ResultSchema = z.object({
  template: classifiedTemplateSummarySchema, createdBook: classifiedCreatedBookSchema.optional(),
}).strict();
export const libraryWriteResultSchema = z.union([libraryCommandV3ResultSchema, libraryCommandV2ResultSchema]);
export type LibraryWriteResult = z.infer<typeof libraryWriteResultSchema>;
export const libraryQuantitiesSchema = z.object({
  uniqueWordCount: z.number().int().nonnegative().nullable(), unknownWordItems: z.number().int().nonnegative(),
  meaningItemCount: z.number().int().nonnegative().nullable(), unknownMeaningItems: z.number().int().nonnegative(),
  sourceSpecificMeaningItems: z.number().int().nonnegative(),
  questionCounts: z.array(z.object({ mode: z.enum(["book_meaning_choice", "canonical_definition_to_headword", "canonical_headword_to_definition"]),
    englishToKorean: z.number().int().nonnegative(), koreanToEnglish: z.number().int().nonnegative() }).strict()).length(3).nullable(),
}).strict();
export const classifiedDetailSchema = libraryDetailSchema.extend({ template: classifiedTemplateSummarySchema, quantities: libraryQuantitiesSchema });
export const classifiedPreviewSchema = libraryQueryResultSchema.options[5].extend({ quantities: libraryQuantitiesSchema });
export const classifiedQueryResultSchema = z.discriminatedUnion("kind", [
  libraryQueryResultSchema.options[0].extend({ items: z.array(classifiedTemplateSummarySchema).max(50) }),
  libraryQueryResultSchema.options[1], classifiedDetailSchema,
  libraryQueryResultSchema.options[3], libraryQueryResultSchema.options[4],
  classifiedPreviewSchema, libraryQueryResultSchema.options[6],
]);
export type ClassifiedTemplateSummary = z.infer<typeof classifiedTemplateSummarySchema>;
export type ClassifiedLibraryDetail = z.infer<typeof classifiedDetailSchema>;
export type ClassifiedQueryResult = z.infer<typeof classifiedQueryResultSchema>;
export type ClassifiedQueryResultOf<K extends ClassifiedQueryResult["kind"]> = Extract<ClassifiedQueryResult, {kind: K}>;
