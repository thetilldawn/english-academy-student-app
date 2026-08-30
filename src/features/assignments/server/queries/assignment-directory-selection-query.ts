import "server-only";

import { z } from "zod";

import type {
  AssignmentDirectorySelectionRequest,
  AssignmentDirectorySelectionResponse,
} from "../../contracts/assignment-workspace-read-model";
import { normalizeStudentDirectoryFilters } from "@/features/students/public-contracts";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAXIMUM_BULK_STUDENT_COUNT } from "../../domain/model";

const selectionStudentSchema = z.object({
  currentVocabBook: z.string().nullable(),
  displayName: z.string().min(1),
  gradeLabel: z.string().nullable(),
  id: z.uuid(),
  schoolName: z.string().nullable(),
});

const selectionRowSchema = z.object({
  item: selectionStudentSchema,
  student_id: z.uuid(),
});

export class AssignmentDirectorySelectionError extends Error {
  constructor(
    readonly reason: "too_many" | "unavailable",
    message = "선택할 학생을 불러오지 못했습니다.",
  ) {
    super(message);
    this.name = "AssignmentDirectorySelectionError";
  }
}

export async function listAssignmentDirectorySelection(
  input: AssignmentDirectorySelectionRequest,
  authenticatedAdmin?: AdminContext,
): Promise<AssignmentDirectorySelectionResponse> {
  if (!authenticatedAdmin) await requireAdmin();
  const filters = normalizeStudentDirectoryFilters(input.filters);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_admin_assignment_directory_selection_v1",
    {
      p_class_group_id: filters.classGroupId || null,
      p_grade: filters.grade,
      p_query: filters.query,
      p_school: filters.school,
      p_snapshot_at: input.snapshotAt,
      p_status: filters.status,
      p_wordbook: filters.wordbook,
      p_wrong: filters.wrong,
    },
  );
  if (error) {
    throw new AssignmentDirectorySelectionError("unavailable");
  }
  const parsed = z.array(selectionRowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new AssignmentDirectorySelectionError(
      "unavailable",
      "선택할 학생 응답을 확인하지 못했습니다.",
    );
  }
  const students = parsed.data.map((row) => row.item);
  if (new Set(students.map((student) => student.id)).size !== students.length) {
    throw new AssignmentDirectorySelectionError(
      "unavailable",
      "선택할 학생 목록에 중복이 있습니다.",
    );
  }
  if (students.length > MAXIMUM_BULK_STUDENT_COUNT) {
    throw new AssignmentDirectorySelectionError(
      "too_many",
      `한 번에 선택할 수 있는 학생은 ${MAXIMUM_BULK_STUDENT_COUNT}명까지입니다. 필터 범위를 좁혀 주세요.`,
    );
  }
  return { students, totalCount: students.length };
}
