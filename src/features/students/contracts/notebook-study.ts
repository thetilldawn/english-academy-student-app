import { z } from "zod";
import { wrongWordFiltersSchema, wrongWordFilterKey } from "./wrong-word-filters";
import { wrongWordNotebookItemSchema, wrongWordNotebookPageSchema } from "./wrong-word-notebook";

export const notebookFiltersSchema = wrongWordFiltersSchema.safeExtend({ sort: z.enum(["count", "recent"]).default("count") });
export type NotebookFilters = z.infer<typeof notebookFiltersSchema>;
export const notebookPronunciationSchema = z.object({
  displayKo: z.string().nullable(), variantId: z.string().nullable(), audioUrl: z.url().nullable(), available: z.boolean(),
  segments: z.array(z.object({ text: z.string(), stress: z.enum(["none", "secondary", "primary"]) })).optional(),
});
export const notebookStudyItemSchema = wrongWordNotebookItemSchema.extend({
  pronunciation: notebookPronunciationSchema, definition: z.string().nullable(), example: z.string().nullable(), exampleKo: z.string().nullable(),
});
export const notebookStudyPageSchema = wrongWordNotebookPageSchema.extend({ items: z.array(notebookStudyItemSchema).max(10) });
export type NotebookWord = z.infer<typeof notebookStudyItemSchema>;
export type NotebookPage = z.infer<typeof notebookStudyPageSchema>;
export function notebookFilterKey(filters: NotebookFilters) { return JSON.stringify([wrongWordFilterKey(filters), filters.sort]); }
export function notebookWordToken(key: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(key))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
