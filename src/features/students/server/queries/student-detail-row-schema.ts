import "server-only";

import { z } from "zod";

import { adminHistoryDetailItemSchema } from "@/features/history/server/queries/admin-history-row-schema";
import { readingCurriculumStages } from "@/lib/admin/reading-curriculum";

const timestampSchema = z.iso.datetime({ offset: true });

export const studentDetailInitialRowSchema = z.object({
  history: z.object({
    items: z.array(z.object({
      effectiveAt: timestampSchema,
      entryKey: z.string().min(1),
      item: adminHistoryDetailItemSchema,
    })).max(11),
    totalCount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  learningSources: z.array(z.object({
    displayLabel: z.string(),
    id: z.uuid(),
    rangeMetadata: z.record(z.string(), z.unknown()),
    sortOrder: z.coerce.number().int().nonnegative(),
    sourceType: z.enum([
      "primary_vocab",
      "exam_vocab",
      "textbook",
      "supplement",
      "mock_exam",
      "passage",
    ]),
    studentId: z.uuid(),
    vocabDatasetId: z.uuid().nullable(),
  })),
  snapshotAt: timestampSchema,
  student: z.object({
    codeStatus: z.enum(["active", "blocked", "expired", "missing"]),
    createdAt: timestampSchema,
    currentVocabBook: z.string().nullable(),
    currentVocabDatasetId: z.uuid().nullable(),
    displayName: z.string(),
    gradeLabel: z.string().nullable(),
    id: z.uuid(),
    rawPoints: z.coerce.number().int()
      .min(Number.MIN_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    readingContextSyncStatus: z.enum([
      "not_synced",
      "not_configured",
      "synced",
      "failed",
    ]),
    readingCurriculumStage: z.enum(readingCurriculumStages),
    schoolName: z.string().nullable(),
    status: z.enum(["active", "blocked"]),
  }),
  vocabBookHistory: z.array(z.object({
    assignmentPurpose: z.enum(["regular", "review", "mixed"]),
    attemptCount: z.coerce.number().int().positive(),
    datasetId: z.uuid(),
    datasetTitle: z.string(),
    lastActivityAt: timestampSchema,
    lastPassed: z.boolean(),
    lastStatus: z.enum(["in_progress", "completed", "expired"]),
    primaryUnitLabels: z.array(z.string()),
    primaryUnitSortIndexes: z.array(z.number().int()).nullable(),
    studentId: z.uuid(),
    unitLabels: z.array(z.string()),
    unitSortIndexes: z.array(z.number().int()).nullable(),
  })),
  wrongSummary: z.object({
    repeatedWrongWordCount: z.coerce.number().int().nonnegative(),
    wrongWordCount: z.coerce.number().int().nonnegative(),
  }),
});
