import { z } from "zod";
import { displayAtomSchema } from "@/lib/quiz/shared-display";
import { quizContentModes } from "@/lib/quiz/question-content-mode";
export const studyManifestSchema = z.object({ assignmentId: z.uuid(), title: z.string(), mode: z.enum(quizContentModes),
  words: z.array(z.object({ key: z.string(), headwordRef: z.string(), meaningRef: z.string(), pronunciationRef: z.string(),
    definitionRef: z.string().nullable(), exampleRef: z.string().nullable(),
    exampleRanges: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })).nullable(),
  })).max(1000), manifestHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const studyMaterialsSchema = z.object({ manifest: studyManifestSchema, atoms: z.array(displayAtomSchema).max(5000) });
export type StudyManifest = z.infer<typeof studyManifestSchema>;
