import "server-only";

import { requireAdmin } from "@/lib/auth/admin";
import { storedDatasetDisplayLabel } from "@/lib/admin/dataset-display";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";
import {
  parseStudentPendingReviewSummaries,
  type PendingReviewSummaryRow,
  type StudentPendingReviewSummary,
} from "@/lib/admin/review-queue-summary";
import type { DatasetOption, DatasetSummary, VocabUnitSummary } from "@/lib/admin/dataset-summary";
import type {
  StudentClassGroupSummary,
  StudentLearningSourceSummary,
  StudentSummary,
} from "@/lib/admin/student-summary";
import {
  parseStudentCurrentVocabWrongSummaries,
  type CurrentVocabWrongSummaryRow,
  type StudentCurrentVocabWrongSummary,
} from "@/lib/admin/wrong-history-summary";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  loadAdminMaterialSnapshot,
  loadAdminVocabUnits,
} from "./admin-material-read-service";

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

type StudentLearningSourceRow = {
  id: string;
  student_id: string;
  source_type: StudentLearningSourceSummary["sourceType"];
  vocab_dataset_id: string | null;
  display_label: string;
  range_metadata: unknown;
  sort_order: number;
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

function mapStudentLearningSourceSummaries(
  sources: readonly StudentLearningSourceRow[],
  datasetLabelById: ReadonlyMap<string, string>,
): StudentLearningSourceSummary[] {
  return sources.map((source) => ({
    id: source.id,
    studentId: source.student_id,
    sourceType: source.source_type,
    vocabDatasetId: source.vocab_dataset_id,
    displayLabel:
      (source.vocab_dataset_id &&
        datasetLabelById.get(source.vocab_dataset_id)) ||
      storedDatasetDisplayLabel(source.display_label),
    rangeMetadata:
      source.range_metadata &&
      typeof source.range_metadata === "object" &&
      !Array.isArray(source.range_metadata)
        ? (source.range_metadata as Record<string, unknown>)
        : {},
    sortOrder: source.sort_order,
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

async function loadStudentLearningSourceRows(supabase: AdminSupabase) {
  return supabase
    .from("student_learning_sources")
    .select(
      "id, student_id, source_type, vocab_dataset_id, display_label, range_metadata, sort_order",
    )
    .eq("active", true)
    .order("sort_order")
    .order("created_at");
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

export async function listStudentClassGroups(): Promise<
  StudentClassGroupSummary[]
> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("class_groups")
    .select("id, name, class_group_students(student_id)")
    .eq("active", true)
    .order("name");
  if (error) {
    if (
      error.code === "42P01" ||
      ((error.code ?? "").startsWith("PGRST") &&
        error.message.includes("class_groups"))
    ) {
      return [];
    }
    throw new Error("수업그룹을 불러오지 못했습니다.");
  }
  return ((data ?? []) as Array<{
    id: string;
    name: string;
    class_group_students: Array<{ student_id: string }> | null;
  }>).map((group) => ({
    id: group.id,
    name: group.name,
    studentIds: (group.class_group_students ?? []).map(
      (membership) => membership.student_id,
    ),
  }));
}

export async function listStudentLearningSources(): Promise<
  StudentLearningSourceSummary[]
> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [sourceResult, material] = await Promise.all([
    loadStudentLearningSourceRows(supabase),
    loadAdminMaterialSnapshot(supabase),
  ]);
  if (sourceResult.error) {
    throw new Error("학생 학습 자료를 불러오지 못했습니다.");
  }
  return mapStudentLearningSourceSummaries(
    (sourceResult.data ?? []) as StudentLearningSourceRow[],
    material.datasetLabelById,
  );
}

export type StudentDirectoryBundle = {
  students: StudentSummary[];
  allDatasets: DatasetSummary[];
  selectableDatasets: DatasetOption[];
  learningSources: StudentLearningSourceSummary[];
  assignmentUnits: VocabUnitSummary[];
};

export async function loadStudentDirectoryBundle(): Promise<
  StudentDirectoryBundle
> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [
    studentResult,
    codeResult,
    learningSourceResult,
    material,
    assignmentUnits,
  ] = await Promise.all([
    loadStudentRows(supabase),
    loadStudentCodeRows(supabase),
    loadStudentLearningSourceRows(supabase),
    loadAdminMaterialSnapshot(supabase),
    loadAdminVocabUnits(supabase),
  ]);
  const rows = requireStudentRows(studentResult, codeResult);
  if (learningSourceResult.error) {
    throw new Error("학생 학습 자료를 불러오지 못했습니다.");
  }

  return {
    students: mapStudentSummaries(
      rows.students,
      rows.codes,
      material.datasetLabelById,
    ),
    allDatasets: material.allDatasets,
    selectableDatasets: material.selectableDatasets,
    learningSources: mapStudentLearningSourceSummaries(
      (learningSourceResult.data ?? []) as StudentLearningSourceRow[],
      material.datasetLabelById,
    ),
    assignmentUnits,
  };
}

export async function loadAssignmentPlanningCatalog(): Promise<{
  students: StudentSummary[];
  datasets: DatasetSummary[];
  units: VocabUnitSummary[];
}> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [studentResult, codeResult, material, units] = await Promise.all([
    loadStudentRows(supabase),
    loadStudentCodeRows(supabase),
    loadAdminMaterialSnapshot(supabase),
    loadAdminVocabUnits(supabase),
  ]);
  const rows = requireStudentRows(studentResult, codeResult);
  return {
    students: mapStudentSummaries(
      rows.students,
      rows.codes,
      material.datasetLabelById,
    ),
    datasets: material.allDatasets,
    units,
  };
}

export async function listStudentPendingReviewSummaries(): Promise<
  StudentPendingReviewSummary[]
> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const summaries: StudentPendingReviewSummary[] = [];
  const pageSize = 500;
  let afterStudentId: string | null = null;
  let afterDatasetId: string | null = null;

  for (;;) {
    const { data, error } = await supabase.rpc(
      "list_student_vocab_review_queue_summaries",
      {
        p_after_student_id: afterStudentId,
        p_after_dataset_id: afterDatasetId,
        p_limit: pageSize,
      },
    );
    if (error || !Array.isArray(data)) {
      throw new Error("학생별 오답 대기 수를 불러오지 못했습니다.");
    }
    const page = parseStudentPendingReviewSummaries(
      data as PendingReviewSummaryRow[],
    );
    summaries.push(...page);
    if (page.length < pageSize) break;
    const last = page.at(-1);
    if (!last) {
      throw new Error("오답 대기 목록 커서를 확인하지 못했습니다.");
    }
    afterStudentId = last.studentId;
    afterDatasetId = last.datasetId;
  }

  return summaries;
}

export async function listStudentCurrentVocabWrongSummaries(): Promise<
  StudentCurrentVocabWrongSummary[]
> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const summaries: StudentCurrentVocabWrongSummary[] = [];
  const pageSize = 500;
  let afterStudentId: string | null = null;

  for (;;) {
    const { data, error } = await supabase.rpc(
      "list_student_current_vocab_wrong_summaries",
      {
        p_after_student_id: afterStudentId,
        p_limit: pageSize,
      },
    );
    if (error || !Array.isArray(data)) {
      throw new Error("학생별 현재 단어장 오답을 불러오지 못했습니다.");
    }
    const page = parseStudentCurrentVocabWrongSummaries(
      data as CurrentVocabWrongSummaryRow[],
    );
    summaries.push(...page);
    if (page.length < pageSize) break;
    const last = page.at(-1);
    if (!last) {
      throw new Error("현재 단어장 오답 목록 커서를 확인하지 못했습니다.");
    }
    afterStudentId = last.studentId;
  }

  return summaries;
}
