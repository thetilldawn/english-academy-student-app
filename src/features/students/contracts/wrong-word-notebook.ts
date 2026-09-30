import { z } from "zod";
import { wrongWordItemSchema } from "./wrong-word-page";

const occurrence = wrongWordItemSchema.shape.occurrences.element.pick({
  datasetId: true, vocabEntryId: true, datasetLabel: true,
  headword: true, primaryMeaning: true, provenanceStatus: true,
});
export const wrongWordNotebookItemSchema = wrongWordItemSchema.pick({
  key: true, headword: true, primaryMeaning: true, wrongCount: true, lastWrongAt: true,
}).extend({ occurrences: z.array(occurrence).min(1) });
const count = z.number().int().nonnegative();
export const wrongWordNotebookSummarySchema = z.object({
  wordCount: count, wrongEventCount: count, repeatedWordCount: count,
});
export const wrongWordNotebookPageSchema = z.object({
  items: z.array(wrongWordNotebookItemSchema).max(10),
  nextCursor: z.string().nullable(),
  totalCount: count.nullable(),
  summary: wrongWordNotebookSummarySchema.nullable(),
  datasetOptions: z.array(z.object({ id: z.uuid(), label: z.string() })).nullable(),
});
export type WrongWordNotebookPage = z.infer<typeof wrongWordNotebookPageSchema>;

