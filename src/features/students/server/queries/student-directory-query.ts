import "server-only";

import { z } from "zod";

import {
  normalizeStudentDirectoryFilters,
  type StudentDirectoryFilters,
  type StudentDirectoryPage,
  type StudentDirectorySnapshot,
} from "../../contracts/student-directory-read-model";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  assertStudentDirectoryCursorFilters,
  decodeStudentDirectoryCursor,
  encodeStudentDirectoryCursor,
  studentDirectoryFilterFingerprint,
} from "../student-directory-cursor";
import { StudentDirectoryReadError } from "./student-directory-read-error";
import {
  type StudentDirectoryNode,
  studentDirectoryInitialRowSchema,
  studentDirectoryPageRowSchema,
} from "./student-directory-row-schema";

const PAGE_SIZE = 10;
const DATABASE_PAGE_LIMIT = PAGE_SIZE + 1;

function rpcFilters(filters: StudentDirectoryFilters) {
  return {
    p_class_group_id: filters.classGroupId || null,
    p_grade: filters.grade,
    p_query: filters.query,
    p_school: filters.school,
    p_status: filters.status,
    p_wordbook: filters.wordbook,
    p_wrong: filters.wrong,
  };
}

function nextCursorFromNodes(input: {
  filters: StudentDirectoryFilters;
  nodes: readonly StudentDirectoryNode[];
  snapshotAt: string;
}) {
  if (input.nodes.length <= PAGE_SIZE) return null;
  const lastVisible = input.nodes[PAGE_SIZE - 1];
  if (!lastVisible) return null;
  return encodeStudentDirectoryCursor({
    filterFingerprint: studentDirectoryFilterFingerprint(input.filters),
    snapshotAt: input.snapshotAt,
    sortAt: lastVisible.sortAt,
    studentId: lastVisible.studentId,
    version: 1,
  });
}

function pageFromNodes(input: {
  filters: StudentDirectoryFilters;
  nodes: readonly StudentDirectoryNode[];
  snapshotAt: string;
}): StudentDirectoryPage {
  return {
    items: input.nodes.slice(0, PAGE_SIZE).map((node) => node.item),
    nextCursor: nextCursorFromNodes(input),
  };
}

export async function getStudentDirectoryInitial(
  input: { filters: StudentDirectoryFilters },
  authenticatedAdmin?: AdminContext,
): Promise<StudentDirectorySnapshot> {
  if (!authenticatedAdmin) await requireAdmin();
  const filters = normalizeStudentDirectoryFilters(input.filters);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_admin_student_directory_initial_v1",
    {
      ...rpcFilters(filters),
      p_limit: DATABASE_PAGE_LIMIT,
      p_snapshot_at: null,
    },
  );
  if (error) {
    throw new StudentDirectoryReadError("학생 목록을 불러오지 못했습니다.");
  }
  const parsed = z.array(studentDirectoryInitialRowSchema).safeParse(data ?? []);
  if (!parsed.success || parsed.data.length !== 1) {
    throw new StudentDirectoryReadError(
      "학생 목록 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const row = parsed.data[0];
  if (row.total_count < Math.min(row.items.length, PAGE_SIZE)) {
    throw new StudentDirectoryReadError(
      "학생 목록 개수를 확인하지 못했습니다.",
      "contract",
    );
  }
  return {
    filterOptions: row.filter_options,
    filters,
    page: pageFromNodes({
      filters,
      nodes: row.items,
      snapshotAt: row.snapshot_at,
    }),
    snapshotAt: row.snapshot_at,
    totalCount: row.total_count,
  };
}

export async function getStudentDirectoryNextPage(
  input: { cursor: string; filters: StudentDirectoryFilters },
  authenticatedAdmin?: AdminContext,
): Promise<StudentDirectoryPage> {
  if (!authenticatedAdmin) await requireAdmin();
  const filters = normalizeStudentDirectoryFilters(input.filters);
  const cursor = decodeStudentDirectoryCursor(input.cursor);
  assertStudentDirectoryCursorFilters(cursor, filters);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_admin_student_directory_page_v1",
    {
      ...rpcFilters(filters),
      p_cursor_sort_at: cursor.sortAt,
      p_cursor_student_id: cursor.studentId,
      p_limit: DATABASE_PAGE_LIMIT,
      p_snapshot_at: cursor.snapshotAt,
    },
  );
  if (error) {
    throw new StudentDirectoryReadError(
      "다음 학생 목록을 불러오지 못했습니다.",
    );
  }
  const parsed = z
    .array(studentDirectoryPageRowSchema)
    .max(DATABASE_PAGE_LIMIT)
    .safeParse(data ?? []);
  if (!parsed.success) {
    throw new StudentDirectoryReadError(
      "다음 학생 목록 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const nodes: StudentDirectoryNode[] = parsed.data.map((row) => ({
    item: row.item,
    sortAt: row.cursor_sort_at,
    studentId: row.cursor_student_id,
  }));
  return pageFromNodes({
    filters,
    nodes,
    snapshotAt: cursor.snapshotAt,
  });
}
