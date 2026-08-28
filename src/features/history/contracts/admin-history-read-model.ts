import type { AdminHistoryStatusFilter } from "@/features/history/domain/learning-activity";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

export const adminHistorySectionKeys = [
  "open",
  "needs_attention",
  "completed",
  "archived",
] as const;

export type AdminHistorySectionKey =
  (typeof adminHistorySectionKeys)[number];

export const adminHistoryStatusFilters = [
  "all",
  "open",
  "needs_attention",
  "missed",
  "completed",
  "retried",
  "archived",
] as const satisfies readonly AdminHistoryStatusFilter[];

export type AdminHistoryReadScope = "all" | "current";

export type AdminHistoryListItem = Pick<
  AssignmentHistorySummary,
  | "activityAt"
  | "assignedAt"
  | "assignmentId"
  | "assignmentPurpose"
  | "assignmentTitle"
  | "attemptId"
  | "availableUntil"
  | "cancelledAt"
  | "completedAt"
  | "datasetTitle"
  | "deadlineAt"
  | "finalScore"
  | "id"
  | "initialCompletedAt"
  | "initialScore"
  | "missedAt"
  | "passed"
  | "passingScore"
  | "phase"
  | "primaryUnitLabels"
  | "questionCount"
  | "retryStartedAt"
  | "startedAt"
  | "status"
  | "studentId"
  | "studentName"
  | "unitLabels"
>;

export type AdminHistorySectionPage = {
  groupKey: string;
  items: AdminHistoryListItem[];
  nextCursor: string | null;
  totalCount: number;
};

export type AdminHistorySnapshot = {
  currentOnly: boolean;
  query: string;
  sections: AdminHistorySectionPage[];
  snapshotAt: string;
  statusFilter: AdminHistoryStatusFilter;
};

export type AdminHistoryNextPage = {
  items: AdminHistoryListItem[];
  nextCursor: string | null;
};

export type AdminHistoryInitialRequest = {
  currentOnly: boolean;
  mode: "initial";
  query: string;
  statusFilter: AdminHistoryStatusFilter;
};

export type AdminHistoryPageRequest = {
  currentOnly: boolean;
  cursor: string;
  groupKey: string;
  mode: "page";
  query: string;
  statusFilter: AdminHistoryStatusFilter;
};

export type AdminHistoryReadRequest =
  | AdminHistoryInitialRequest
  | AdminHistoryPageRequest;

export function normalizeAdminHistoryQuery(query: string) {
  return query.replace(/\s+/gu, " ").trim().slice(0, 80);
}

export function isAdminHistoryStatusFilter(
  value: unknown,
): value is AdminHistoryStatusFilter {
  return typeof value === "string" &&
    adminHistoryStatusFilters.includes(value as AdminHistoryStatusFilter);
}

export function isAdminHistorySectionKey(
  value: unknown,
): value is AdminHistorySectionKey {
  return typeof value === "string" &&
    adminHistorySectionKeys.includes(value as AdminHistorySectionKey);
}
