import { z } from "zod";
import { displayAtomSchema } from "@/lib/quiz/shared-display";
import { quizContentModes } from "@/lib/quiz/question-content-mode";
import { assignmentReleaseSchema } from "@/lib/assignment/assignment-release";
const studyHeaderSchema = z.object({ assignmentId: z.uuid(), studentId: z.uuid(), title: z.string(), mode: z.enum(quizContentModes) });
export const openStudyAccessSchema = studyHeaderSchema.extend({ revision: z.string().regex(/^[a-f0-9]{32}$/) });
export const lockedStudyAccessSchema = studyHeaderSchema.extend({ release: assignmentReleaseSchema });
export const studyAccessSchema = z.union([openStudyAccessSchema, lockedStudyAccessSchema]);
export type OpenStudyAccess = z.infer<typeof openStudyAccessSchema>;
export type StudyAccess = z.infer<typeof studyAccessSchema>;
export const studyManifestSchema = z.object({ assignmentId: z.uuid(), title: z.string(), mode: z.enum(quizContentModes),
  words: z.array(z.object({ key: z.string(), headwordRef: z.string(), meaningRef: z.string(), pronunciationRef: z.string(),
    definitionRef: z.string().nullable(), exampleRef: z.string().nullable(),
    exampleRanges: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })).nullable(),
  })).max(1000), manifestHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const studyMaterialsSchema = z.object({ manifest: studyManifestSchema, atoms: z.array(displayAtomSchema).max(5000) });
export const studyResponseSchema = z.union([
  studyMaterialsSchema.extend({ access: openStudyAccessSchema }),
  z.object({ locked: lockedStudyAccessSchema }),
]);
export type StudyManifest = z.infer<typeof studyManifestSchema>;
