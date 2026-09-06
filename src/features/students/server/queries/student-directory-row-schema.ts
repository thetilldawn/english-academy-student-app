import "server-only";

import { z } from "zod";
import { studentDirectoryListItemSchema, studentDirectoryFilterOptionsSchema, directoryIntegerSchema } from "../../contracts/student-directory-cache-contract";
export { studentDirectoryListItemSchema, studentDirectoryFilterOptionsSchema };

const timestampSchema = z.iso.datetime({ offset: true });

export const studentDirectoryNodeSchema = z.object({
  item: studentDirectoryListItemSchema,
  sortAt: timestampSchema,
  studentId: z.uuid(),
});

export const studentDirectoryInitialRowSchema = z.object({
  filter_options: studentDirectoryFilterOptionsSchema,
  items: z.array(studentDirectoryNodeSchema).max(11),
  snapshot_at: timestampSchema,
  total_count: directoryIntegerSchema.refine(value => value >= 0),
});

export const studentDirectoryPageRowSchema = z.object({
  cursor_sort_at: timestampSchema,
  cursor_student_id: z.uuid(),
  item: studentDirectoryListItemSchema,
});

export type StudentDirectoryNode = z.infer<
  typeof studentDirectoryNodeSchema
>;
