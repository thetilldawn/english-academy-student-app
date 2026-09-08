import { z } from "zod";

import {
  adminHistoryStatusFilters,
  expectedAdminHistoryGroupKeys,
  normalizeAdminHistoryQuery,
  type AdminHistoryInitialRequest,
  type AdminHistoryListItem,
} from "../contracts/admin-history-read-model";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";
import { historyCacheIdentitySchema, type HistoryCacheRequest, type HistoryCacheResponse } from "../contracts/history-list-cache-contract";

const timestamp = z.iso.datetime({ offset: true });
const nullableTimestamp = timestamp.nullable();

// The public list projection, not the server-only DB row or question detail.
// z.object strips extra fields, including accidental question/answer payloads.
const itemSchema = z.object({
  activityAt: timestamp,
  assignedAt: timestamp,
  assignmentId: z.uuid(),
  assignmentPurpose: z.enum(["regular", "review", "mixed"]),
  assignmentTitle: z.string(),
  attemptId: z.uuid().nullable(),
  availableUntil: nullableTimestamp,
  cancelledAt: nullableTimestamp,
  completedAt: nullableTimestamp,
  datasetTitle: z.string(),
  deadlineAt: nullableTimestamp,
  finalScore: z.number().nullable(),
  id: z.string().min(1),
  initialCompletedAt: nullableTimestamp.optional(),
  initialScore: z.number().nullable(),
  missedAt: nullableTimestamp,
  passed: z.boolean().nullable(),
  passingScore: z.number(),
  phase: z.enum(["initial", "review", "retry", "completed"]).nullable(),
  primaryUnitLabels: z.array(z.string()),
  questionCount: z.number().int().nonnegative(),
  retryStartedAt: nullableTimestamp,
  startedAt: nullableTimestamp,
  status: z.enum(["not_started", "cancelled", "missed", "in_progress", "completed", "expired"]),
  studentId: z.uuid(),
  studentName: z.string(),
  schoolName: z.string().nullable().optional(),
  gradeLabel: z.string().nullable().optional(),
  unitLabels: z.array(z.string()),
}) satisfies z.ZodType<AdminHistoryListItem>;

const pageSchema = z.object({
  items: z.array(itemSchema),
  nextCursor: z.string().min(1).nullable(),
});
const sectionSchema = pageSchema.extend({
  groupKey: z.string().min(1),
  totalCount: z.number().int().nonnegative(),
  version: timestamp.optional(),
}).refine((section) => section.totalCount >= section.items.length);
const snapshotSchema = z.object({
  currentOnly: z.boolean(),
  query: z.string(),
  sections: z.array(sectionSchema),
  snapshotAt: timestamp,
  statusFilter: z.enum(adminHistoryStatusFilters),
}).refine(({ sections }) => new Set(sections.map((section) => section.groupKey)).size === sections.length);

export function parseHistorySnapshot(payload: unknown, request: AdminHistoryInitialRequest) {
  const parsed = z.object({ snapshot: snapshotSchema }).safeParse(payload);
  const expectedGroups = expectedAdminHistoryGroupKeys(request.currentOnly, request.statusFilter);
  if (!parsed.success ||
      parsed.data.snapshot.currentOnly !== request.currentOnly ||
      parsed.data.snapshot.query !== normalizeAdminHistoryQuery(request.query) ||
      parsed.data.snapshot.statusFilter !== request.statusFilter ||
      parsed.data.snapshot.sections.length !== expectedGroups.length ||
      parsed.data.snapshot.sections.some(({ groupKey }) => !expectedGroups.includes(groupKey))) {
    throw new AdminHistoryRequestError("invalid-response");
  }
  return parsed.data.snapshot;
}

export function parseHistoryNextPage(payload: unknown) {
  const parsed = z.object({ page: pageSchema }).safeParse(payload);
  if (!parsed.success) throw new AdminHistoryRequestError("invalid-response");
  return parsed.data.page;
}

export function parseHistoryCacheResponse(payload: unknown, request: HistoryCacheRequest): HistoryCacheResponse {
  const metadata = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("snapshot"), identity: historyCacheIdentitySchema.nullable(), userId: z.uuid() }),
    z.object({ kind: z.literal("resume"), identity: historyCacheIdentitySchema, userId: z.uuid() }),
  ]).safeParse(payload);
  if (!metadata.success) throw new AdminHistoryRequestError("invalid-response");
  if (metadata.data.kind === "resume") {
    if (!request.identity || request.identity !== metadata.data.identity) throw new AdminHistoryRequestError("invalid-response");
    return metadata.data;
  }
  return { ...metadata.data, snapshot: parseHistorySnapshot(payload, { ...request.filters, mode: "initial" }) };
}

export function parseHistorySection(payload: unknown, groupKey: string) {
  const parsed = z.object({ section: sectionSchema }).safeParse(payload);
  if (!parsed.success || parsed.data.section.groupKey !== groupKey) {
    throw new AdminHistoryRequestError("invalid-response");
  }
  return parsed.data.section;
}
