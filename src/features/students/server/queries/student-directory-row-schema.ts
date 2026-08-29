import "server-only";

import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });

export const studentDirectoryListItemSchema = z.object({
  codeStatus: z.enum(["active", "blocked", "expired", "missing"]),
  completedCount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currentVocabBook: z.string().nullable(),
  displayName: z.string().min(1),
  gradeLabel: z.string().nullable(),
  id: z.uuid(),
  missedCount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  notStartedCount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rawPoints: z.coerce.number().int()
    .min(Number.MIN_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER),
  recentExamAt: timestampSchema.nullable(),
  schoolName: z.string().nullable(),
  status: z.enum(["active", "blocked"]),
});

export const studentDirectoryNodeSchema = z.object({
  item: studentDirectoryListItemSchema,
  sortAt: timestampSchema,
  studentId: z.uuid(),
});

export const studentDirectoryFilterOptionsSchema = z.object({
  classGroups: z.array(z.object({ id: z.uuid(), name: z.string().min(1) })),
  grades: z.array(z.string()),
  schools: z.array(z.string()),
  wordbooks: z.array(z.string()),
});

export const studentDirectoryInitialRowSchema = z.object({
  filter_options: studentDirectoryFilterOptionsSchema,
  items: z.array(studentDirectoryNodeSchema).max(11),
  snapshot_at: timestampSchema,
  total_count: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const studentDirectoryPageRowSchema = z.object({
  cursor_sort_at: timestampSchema,
  cursor_student_id: z.uuid(),
  item: studentDirectoryListItemSchema,
});

export type StudentDirectoryNode = z.infer<
  typeof studentDirectoryNodeSchema
>;
