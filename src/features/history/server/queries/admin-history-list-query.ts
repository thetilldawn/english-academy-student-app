import "server-only";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import {
  type AdminHistoryNextPage,
  type AdminHistoryReadScope,
  type AdminHistorySectionPage,
  type AdminHistorySnapshot,
  adminHistorySectionKeys,
  normalizeAdminHistoryQuery,
} from "@/features/history/contracts/admin-history-read-model";
import type { AdminHistoryStatusFilter } from "@/features/history/domain/learning-activity";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import {
  awaitWithAbortSignal,
  createRequestDeadline,
  INTERACTIVE_READ_REQUEST_DEADLINE_MS,
  requestTimeoutWithinBudget,
} from "@/lib/network/request-policy";
import { getCurrentRequestContext } from "@/lib/observability/server-request-context";
import { logServerOperationTiming } from "@/lib/observability/request-timing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  adminHistoryFilterFingerprint,
  assertAdminHistoryCursorScope,
  decodeAdminHistoryCursor,
  encodeAdminHistoryCursor,
} from "../admin-history-cursor";
import { AdminHistoryReadError } from "./admin-history-read-error";
import {
  type AdminHistoryPageNode,
  adminHistoryInitialRowSchema,
  adminHistoryPageRowSchema,
  mapAdminHistoryListItem,
} from "./admin-history-row-schema";

const PAGE_SIZE = 10;
const DATABASE_PAGE_LIMIT = PAGE_SIZE + 1;

type HistorySupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

async function runAdminHistoryRead<T>(input: {
  errorMessage: string;
  operation: string;
  parentSignal?: AbortSignal;
  read: (
    supabase: HistorySupabaseClient,
  ) => PromiseLike<{ data: T | null; error: unknown }>;
}): Promise<T | null> {
  const requestContext = await getCurrentRequestContext();
  const deadline = createRequestDeadline(
    requestTimeoutWithinBudget(
      INTERACTIVE_READ_REQUEST_DEADLINE_MS,
      requestContext.absoluteDeadlineAt,
    ),
    input.parentSignal,
  );
  const startedAt = performance.now();
  let outcome: "cancelled" | "error" | "success" | "timeout" = "success";

  try {
    const supabase = await createServerSupabaseClient({
      signal: deadline.signal,
    });
    const { data, error } = await awaitWithAbortSignal(
      input.read(supabase),
      deadline.signal,
    );
    if (deadline.expired) {
      outcome = "timeout";
      throw new AdminHistoryReadError(
        "시험 내역 응답이 늦어지고 있습니다. 다시 시도해 주세요.",
        "timeout",
      );
    }
    if (error) {
      outcome = input.parentSignal?.aborted ? "cancelled" : "error";
      throw new AdminHistoryReadError(input.errorMessage);
    }
    return data;
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AdminHistoryReadError) throw error;
    outcome = deadline.expired
      ? "timeout"
      : input.parentSignal?.aborted
        ? "cancelled"
        : "error";
    throw new AdminHistoryReadError(
      deadline.expired
        ? "시험 내역 응답이 늦어지고 있습니다. 다시 시도해 주세요."
        : input.errorMessage,
      deadline.expired ? "timeout" : "database",
    );
  } finally {
    deadline.dispose();
    logServerOperationTiming({
      durationMs: performance.now() - startedAt,
      operation: input.operation,
      outcome,
      requestId: requestContext.requestId,
    });
  }
}

function pageScope(currentOnly: boolean): AdminHistoryReadScope {
  return currentOnly ? "current" : "all";
}

function nextCursorFromNodes(input: {
  currentOnly: boolean;
  groupKey: string;
  nodes: readonly AdminHistoryPageNode[];
  query: string;
  snapshotAt: string;
  statusFilter: AdminHistoryStatusFilter;
}) {
  if (input.nodes.length <= PAGE_SIZE) return null;
  const lastVisible = input.nodes[PAGE_SIZE - 1];
  if (!lastVisible) return null;
  const scope = pageScope(input.currentOnly);
  return encodeAdminHistoryCursor({
    effectiveAt: lastVisible.effectiveAt,
    entryKey: lastVisible.entryKey,
    filterFingerprint: adminHistoryFilterFingerprint({
      groupKey: input.groupKey,
      query: input.query,
      scope,
      statusFilter: input.statusFilter,
    }),
    groupKey: input.groupKey,
    scope,
    snapshotAt: input.snapshotAt,
    version: 1,
  });
}

function expectedGroupKeys(
  currentOnly: boolean,
  statusFilter: AdminHistoryStatusFilter,
) {
  if (statusFilter !== "all") return [`filter-${statusFilter}`];
  return adminHistorySectionKeys.filter(
    (section) => !currentOnly || section !== "archived",
  );
}

function buildInitialSnapshot(
  rows: readonly z.infer<typeof adminHistoryInitialRowSchema>[],
  input: {
    currentOnly: boolean;
    query: string;
    statusFilter: AdminHistoryStatusFilter;
  },
): AdminHistorySnapshot {
  const expected = expectedGroupKeys(input.currentOnly, input.statusFilter);
  const rowByGroup = new Map(rows.map((row) => [row.group_key, row]));
  const snapshotAt = rows[0]?.snapshot_at;
  if (
    !snapshotAt ||
    rowByGroup.size !== rows.length ||
    rows.some((row) => !expected.includes(row.group_key as never)) ||
    rows.some((row) => row.snapshot_at !== snapshotAt) ||
    expected.some((groupKey) => !rowByGroup.has(groupKey))
  ) {
    throw new AdminHistoryReadError(
      "내역 구역 응답을 확인하지 못했습니다.",
      "contract",
    );
  }

  const sections = expected.map((groupKey): AdminHistorySectionPage => {
    const row = rowByGroup.get(groupKey)!;
    return {
      groupKey,
      items: row.items
        .slice(0, PAGE_SIZE)
        .map((node) => mapAdminHistoryListItem(node.item)),
      nextCursor: nextCursorFromNodes({
        ...input,
        groupKey,
        nodes: row.items,
        snapshotAt: row.snapshot_at,
      }),
      totalCount: row.total_count,
      version: row.snapshot_at,
    };
  });

  return {
    ...input,
    sections,
    snapshotAt,
  };
}

export async function listAdminHistoryInitial(input: {
  currentOnly: boolean;
  query?: string;
  snapshotAt?: string | null;
  statusFilter?: AdminHistoryStatusFilter;
}, authenticatedAdmin?: AdminContext, parentSignal?: AbortSignal): Promise<
  AdminHistorySnapshot
> {
  if (!authenticatedAdmin) await requireAdmin();
  const query = normalizeAdminHistoryQuery(input.query ?? "");
  const statusFilter = input.statusFilter ?? "all";
  const data = await runAdminHistoryRead({
    errorMessage: "시험 내역을 불러오지 못했습니다.",
    operation: "admin.history.initial",
    parentSignal,
    read: (supabase) => supabase.rpc(
      "get_admin_history_initial_v1",
      {
        p_current_only: input.currentOnly,
        p_limit: DATABASE_PAGE_LIMIT,
        p_query: query,
        p_snapshot_at: input.snapshotAt ?? null,
        p_status_filter: statusFilter,
      },
    ),
  });
  const parsed = z.array(adminHistoryInitialRowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new AdminHistoryReadError(
      "시험 내역 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  return buildInitialSnapshot(parsed.data, {
    currentOnly: input.currentOnly,
    query,
    statusFilter,
  });
}

export async function listAdminHistoryNextPage(input: {
  currentOnly: boolean;
  cursor: string;
  groupKey: string;
  query?: string;
  statusFilter?: AdminHistoryStatusFilter;
}, authenticatedAdmin?: AdminContext, parentSignal?: AbortSignal): Promise<
  AdminHistoryNextPage
> {
  if (!authenticatedAdmin) await requireAdmin();
  const query = normalizeAdminHistoryQuery(input.query ?? "");
  const statusFilter = input.statusFilter ?? "all";
  const scope = pageScope(input.currentOnly);
  const cursor = decodeAdminHistoryCursor(input.cursor);
  assertAdminHistoryCursorScope(cursor, {
    groupKey: input.groupKey,
    query,
    scope,
    statusFilter,
  });

  const data = await runAdminHistoryRead({
    errorMessage: "다음 시험 내역을 불러오지 못했습니다.",
    operation: "admin.history.page",
    parentSignal,
    read: (supabase) => supabase.rpc(
      "list_admin_history_page_v1",
      {
        p_current_only: input.currentOnly,
        p_cursor_effective_at: cursor.effectiveAt,
        p_cursor_entry_key: cursor.entryKey,
        p_group_key: input.groupKey,
        p_limit: DATABASE_PAGE_LIMIT,
        p_query: query,
        p_snapshot_at: cursor.snapshotAt,
        p_status_filter: statusFilter,
      },
    ),
  });
  const parsed = z
    .array(adminHistoryPageRowSchema)
    .max(DATABASE_PAGE_LIMIT)
    .safeParse(data ?? []);
  if (!parsed.success) {
    throw new AdminHistoryReadError(
      "다음 시험 내역 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const nodes: AdminHistoryPageNode[] = parsed.data.map((row) => ({
    effectiveAt: row.cursor_effective_at,
    entryKey: row.cursor_entry_key,
    item: row.item,
  }));
  return {
    items: nodes
      .slice(0, PAGE_SIZE)
      .map((node) => mapAdminHistoryListItem(node.item)),
    nextCursor: nextCursorFromNodes({
      currentOnly: input.currentOnly,
      groupKey: input.groupKey,
      nodes,
      query,
      snapshotAt: cursor.snapshotAt,
      statusFilter,
    }),
  };
}

export async function listAdminHistoryFreshSection(input: {
  currentOnly: boolean;
  groupKey: string;
  query?: string;
  snapshotAt: string;
  statusFilter?: AdminHistoryStatusFilter;
}, authenticatedAdmin?: AdminContext, parentSignal?: AbortSignal): Promise<
  AdminHistorySectionPage
> {
  if (!authenticatedAdmin) await requireAdmin();
  const query = normalizeAdminHistoryQuery(input.query ?? "");
  const statusFilter = input.statusFilter ?? "all";
  if (!expectedGroupKeys(input.currentOnly, statusFilter).includes(input.groupKey as never)) {
    throw new AdminHistoryReadError(
      "새로 읽을 내역 구역을 확인하지 못했습니다.",
      "input",
    );
  }

  const parsedSnapshotAt = z.iso.datetime({ offset: true }).safeParse(
    input.snapshotAt,
  );
  if (!parsedSnapshotAt.success) {
    throw new AdminHistoryReadError(
      "새로 읽을 내역 기준 시각을 확인하지 못했습니다.",
      "input",
    );
  }
  const freshSnapshot = await listAdminHistoryInitial(
    {
      currentOnly: input.currentOnly,
      query,
      statusFilter,
    },
    authenticatedAdmin,
    parentSignal,
  );
  const section = freshSnapshot.sections.find(
    (candidate) => candidate.groupKey === input.groupKey,
  );
  if (!section) {
    throw new AdminHistoryReadError(
      "새로 읽은 내역 구역을 확인하지 못했습니다.",
      "contract",
    );
  }
  return section;
}
