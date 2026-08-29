import "server-only";

import { z } from "zod";

import { adminHistoryListItemSchema } from "@/features/history/server/queries/admin-history-row-schema";

const timestampSchema = z.iso.datetime({ offset: true });

export const studentHistoryNodeSchema = z.object({
  effectiveAt: timestampSchema,
  entryKey: z.string().min(1),
  item: adminHistoryListItemSchema,
});

export const studentHistoryInitialRowSchema = z.object({
  items: z.array(studentHistoryNodeSchema).max(11),
  snapshot_at: timestampSchema,
  total_count: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const studentHistoryPageRowSchema = z.object({
  cursor_effective_at: timestampSchema,
  cursor_entry_key: z.string().min(1),
  item: adminHistoryListItemSchema,
});

export type StudentHistoryNode = z.infer<typeof studentHistoryNodeSchema>;
