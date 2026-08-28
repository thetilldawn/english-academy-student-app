import "server-only";

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
  statusFilter?: AdminHistoryStatusFilter;
}, authenticatedAdmin?: AdminContext): Promise<AdminHistorySnapshot> {
  if (!authenticatedAdmin) await requireAdmin();
  const query = normalizeAdminHistoryQuery(input.query ?? "");
  const statusFilter = input.statusFilter ?? "all";
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_admin_history_initial_v1",
    {
      p_current_only: input.currentOnly,
      p_limit: DATABASE_PAGE_LIMIT,
      p_query: query,
      p_snapshot_at: null,
      p_status_filter: statusFilter,
    },
  );
  if (error) {
    throw new AdminHistoryReadError("시험 내역을 불러오지 못했습니다.");
  }
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
}, authenticatedAdmin?: AdminContext): Promise<AdminHistoryNextPage> {
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

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
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
  );
  if (error) {
    throw new AdminHistoryReadError("다음 시험 내역을 불러오지 못했습니다.");
  }
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
