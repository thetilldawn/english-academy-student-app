import "server-only";

import { z } from "zod";

import { mapAdminHistoryListItem } from "@/features/history/public-server";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type {
  StudentHistoryFilters,
  StudentHistoryPage,
  StudentHistoryPageChunk,
} from "../../contracts/student-detail-read-model";
import {
  assertStudentHistoryCursorScope,
  decodeStudentHistoryCursor,
  encodeStudentHistoryCursor,
  studentHistoryFilterFingerprint,
} from "../student-history-cursor";
import { StudentDetailReadError } from "./student-detail-read-error";
import {
  type StudentHistoryNode,
  studentHistoryInitialRowSchema,
  studentHistoryPageRowSchema,
} from "./student-history-row-schema";

const PAGE_SIZE = 10;
const DATABASE_PAGE_LIMIT = PAGE_SIZE + 1;

function rpcFilters(filters: StudentHistoryFilters) {
  return {
    p_purpose: filters.purpose,
    p_section: filters.section,
    p_since: filters.since,
  };
}

function chunkFromNodes(input: {
  filters: StudentHistoryFilters;
  nodes: readonly StudentHistoryNode[];
  snapshotAt: string;
  studentId: string;
}): StudentHistoryPageChunk {
  const lastVisible = input.nodes[PAGE_SIZE - 1];
  return {
    items: input.nodes
      .slice(0, PAGE_SIZE)
      .map((node) => mapAdminHistoryListItem(node.item)),
    nextCursor:
      input.nodes.length > PAGE_SIZE && lastVisible
        ? encodeStudentHistoryCursor({
            effectiveAt: lastVisible.effectiveAt,
            entryKey: lastVisible.entryKey,
            filterFingerprint: studentHistoryFilterFingerprint(input.filters),
            snapshotAt: input.snapshotAt,
            studentId: input.studentId,
            version: 1,
          })
        : null,
  };
}

export async function getStudentHistoryInitial(input: {
  filters: StudentHistoryFilters;
  studentId: string;
}, authenticatedAdmin?: AdminContext): Promise<StudentHistoryPage> {
  if (!authenticatedAdmin) await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_admin_student_history_initial_v1",
    {
      ...rpcFilters(input.filters),
      p_limit: DATABASE_PAGE_LIMIT,
      p_snapshot_at: null,
      p_student_id: input.studentId,
    },
  );
  if (error) {
    throw new StudentDetailReadError("학생 시험 내역을 불러오지 못했습니다.");
  }
  const parsed = z.array(studentHistoryInitialRowSchema).safeParse(data ?? []);
  if (!parsed.success || parsed.data.length !== 1) {
    throw new StudentDetailReadError(
      "학생 시험 내역 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const row = parsed.data[0];
  return {
    ...chunkFromNodes({
      filters: input.filters,
      nodes: row.items,
      snapshotAt: row.snapshot_at,
      studentId: input.studentId,
    }),
    totalCount: row.total_count,
  };
}

export async function getStudentHistoryNextPage(input: {
  cursor: string;
  filters: StudentHistoryFilters;
  studentId: string;
}, authenticatedAdmin?: AdminContext): Promise<StudentHistoryPageChunk> {
  if (!authenticatedAdmin) await requireAdmin();
  const cursor = decodeStudentHistoryCursor(input.cursor);
  assertStudentHistoryCursorScope(cursor, input);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_admin_student_history_page_v1",
    {
      ...rpcFilters(input.filters),
      p_cursor_effective_at: cursor.effectiveAt,
      p_cursor_entry_key: cursor.entryKey,
      p_limit: DATABASE_PAGE_LIMIT,
      p_snapshot_at: cursor.snapshotAt,
      p_student_id: input.studentId,
    },
  );
  if (error) {
    throw new StudentDetailReadError(
      "다음 학생 시험 내역을 불러오지 못했습니다.",
    );
  }
  const parsed = z
    .array(studentHistoryPageRowSchema)
    .max(DATABASE_PAGE_LIMIT)
    .safeParse(data ?? []);
  if (!parsed.success) {
    throw new StudentDetailReadError(
      "다음 학생 시험 내역 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const nodes: StudentHistoryNode[] = parsed.data.map((row) => ({
    effectiveAt: row.cursor_effective_at,
    entryKey: row.cursor_entry_key,
    item: row.item,
  }));
  return chunkFromNodes({
    filters: input.filters,
    nodes,
    snapshotAt: cursor.snapshotAt,
    studentId: input.studentId,
  });
}
