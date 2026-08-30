import "server-only";

import { requireAdmin } from "@/lib/auth/admin";
import { storedDatasetDisplayLabel } from "@/lib/admin/dataset-display";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";
import type { StudentSummary } from "@/lib/admin/student-summary";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { loadAdminMaterialSnapshot } from "./admin-material-read-service";

type AdminSupabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type StudentRow = {
  id: string;
  display_name: string;
  school_name: string | null;
  grade_label: string | null;
  current_vocab_book: string | null;
  current_vocab_dataset_id: string | null;
  reading_curriculum_stage: ReadingCurriculumStage;
  reading_context_sync_status:
    | "not_synced"
    | "not_configured"
    | "synced"
    | "failed";
  status: "active" | "blocked";
  code_generation: number;
  created_at: string;
};

type StudentCodeRow = {
  student_id: string;
  status: "active" | "blocked";
  expires_at: string | null;
};

function mapStudentSummaries(
  students: readonly StudentRow[],
  codes: readonly StudentCodeRow[],
  datasetLabelById: ReadonlyMap<string, string>,
  now = Date.now(),
): StudentSummary[] {
  const codeByStudent = new Map(
    codes.map((code) => [
      code.student_id,
      code.status === "active" &&
      code.expires_at !== null &&
      Date.parse(code.expires_at) <= now
        ? ("expired" as const)
        : code.status,
    ]),
  );

  return students.map((student) => ({
    id: student.id,
    displayName: student.display_name,
    schoolName: student.school_name,
    gradeLabel: student.grade_label,
    currentVocabBook:
      (student.current_vocab_dataset_id
        ? datasetLabelById.get(student.current_vocab_dataset_id)
        : null) ??
      (student.current_vocab_book
        ? storedDatasetDisplayLabel(student.current_vocab_book)
        : null),
    currentVocabDatasetId: student.current_vocab_dataset_id,
    readingCurriculumStage: student.reading_curriculum_stage,
    readingContextSyncStatus: student.reading_context_sync_status,
    status: student.status,
    codeGeneration: student.code_generation,
    codeStatus: codeByStudent.get(student.id) ?? "missing",
    createdAt: student.created_at,
  }));
}

async function loadStudentRows(supabase: AdminSupabase) {
  return supabase
    .from("students")
    .select(
      "id, display_name, school_name, grade_label, current_vocab_book, current_vocab_dataset_id, reading_curriculum_stage, reading_context_sync_status, status, code_generation, created_at",
    )
    .is("deleted_at", null)
    .order("display_name");
}

async function loadStudentCodeRows(supabase: AdminSupabase) {
  return supabase.from("student_codes").select("student_id, status, expires_at");
}

function requireStudentRows(
  studentResult: Awaited<ReturnType<typeof loadStudentRows>>,
  codeResult: Awaited<ReturnType<typeof loadStudentCodeRows>>,
) {
  if (studentResult.error) {
    throw new Error("학생 목록을 불러오지 못했습니다.");
  }
  if (codeResult.error) {
    throw new Error("학생 접속 상태를 불러오지 못했습니다.");
  }
  return {
    students: (studentResult.data ?? []) as StudentRow[],
    codes: (codeResult.data ?? []) as StudentCodeRow[],
  };
}

export async function listStudents(): Promise<StudentSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [studentResult, codeResult, material] = await Promise.all([
    loadStudentRows(supabase),
    loadStudentCodeRows(supabase),
    loadAdminMaterialSnapshot(supabase),
  ]);
  const rows = requireStudentRows(studentResult, codeResult);
  return mapStudentSummaries(
    rows.students,
    rows.codes,
    material.datasetLabelById,
  );
}
