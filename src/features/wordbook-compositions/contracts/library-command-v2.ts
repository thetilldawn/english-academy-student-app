import { z } from "zod";
import { createdLibraryBookSchema, libraryCommandSchema, libraryHashSchema, libraryRecipeSchema, templateMetadataSchema } from "./library";
import { libraryCriteriaSchema, libraryTemplateSummarySchema } from "./library-query";

const requestId = z.uuid();
const expected = { templateId: z.uuid(), expectedRevision: z.number().int().positive() };
const range = { recipe: libraryRecipeSchema, criteria: libraryCriteriaSchema.nullable(), previewHash: libraryHashSchema };
export const libraryCommandV2Schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestId, metadata: templateMetadataSchema, ...range }).strict(),
  z.object({ action: z.literal("version"), requestId, ...expected, metadata: templateMetadataSchema, expectedContentHash: libraryHashSchema, ...range }).strict(),
  libraryCommandSchema.options[1], libraryCommandSchema.options[3], libraryCommandSchema.options[4],
  z.object({ action: z.literal("delete"), requestId, ...expected }).strict(),
]);
export type LibraryCommandV2 = z.infer<typeof libraryCommandV2Schema>;
export const libraryCommandV2ResultSchema = z.union([
  z.object({ template: libraryTemplateSummarySchema, createdBook: createdLibraryBookSchema.optional() }).strict(),
  z.object({ deleted: z.object({ templateId: z.uuid(), revision: z.number().int().positive() }).strict() }).strict(),
]);
export type LibraryCommandV2Result = z.infer<typeof libraryCommandV2ResultSchema>;
