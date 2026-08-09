import "server-only";

import { getStudentCodeEnvironment } from "@/lib/env";
import {
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";
import {
  decryptStudentCode,
  encryptStudentCode,
  generateStudentCode,
  hashStudentCode,
} from "@/lib/auth/student-code";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import {
  finalizeQuizAttemptIfStale,
  finalizeStaleQuizAttempts,
} from "@/lib/services/stale-attempt-service";
import {
  getAttemptQuestionResults,
  type AttemptQuestionResult,
} from "@/lib/services/quiz-service";
import { deriveAttemptQuestionMetrics } from "@/lib/quiz/result-presentation";
import { createMixedQuizQuestions } from "@/lib/quiz/engine";
import {
  datasetDisplayLabel,
  storedDatasetDisplayLabel,
} from "@/lib/ui/dataset-display";
import {
  activeReviewIdentities,
  loadActiveReviewAssignments,
} from "@/lib/services/active-review-assignment-service";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import {
  loadDatasetDisplayLabel,
  loadDatasetDisplayLabelMap,
} from "@/lib/services/dataset-catalog-service";
import {
  buildAssignmentHistory,
  projectCurrentAssignmentHistory,
  type AssignmentHistorySource,
  type AssignmentHistorySummary,
  type AttemptHistorySource,
} from "@/lib/admin/history";
import { learningActivitySection } from "@/lib/admin/learning-activity";
import {
  historyEntryKey,
  parseHistoryEntryKey,
} from "@/lib/admin/history-route";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import {
  parseStudentPendingReviewSummaries,
  type PendingReviewSummaryRow,
  type StudentPendingReviewSummary,
} from "@/lib/admin/review-queue-summary";
import {
  parseStudentCurrentVocabWrongSummaries,
  type CurrentVocabWrongSummaryRow,
  type StudentCurrentVocabWrongSummary,
} from "@/lib/admin/wrong-history-summary";
import {
  cataloguedDatasetDisplayLabel,
  compareCataloguedDatasets,
  type CataloguedDataset,
  type CataloguedUnit,
  type DatasetCatalogGroup,
  type DatasetMaterialKind,
  type VocabUnitType,
} from "@/lib/admin/dataset-catalog";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";
import { resolveOrderedContiguousUnits } from "@/lib/admin/unit-range";

export { buildStudentProgress } from "@/lib/admin/progress";
export type { StudentProgressSummary } from "@/lib/admin/progress";
export type { AssignmentHistorySummary } from "@/lib/admin/history";
export type { StudentPendingReviewSummary } from "@/lib/admin/review-queue-summary";
export type { StudentCurrentVocabWrongSummary } from "@/lib/admin/wrong-history-summary";

export type StudentSummary = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  readingCurriculumStage: ReadingCurriculumStage;
  readingContextSyncStatus:
    | "not_synced"
    | "not_configured"
    | "synced"
    | "failed";
  status: "active" | "blocked";
  codeGeneration: number;
  codeStatus: "active" | "blocked" | "expired" | "missing";
  createdAt: string;
};

export type StudentLearningSourceSummary = {
  id: string;
  studentId: string;
  sourceType:
    | "primary_vocab"
    | "exam_vocab"
    | "textbook"
    | "supplement"
    | "mock_exam"
    | "passage";
  vocabDatasetId: string | null;
  displayLabel: string;
  rangeMetadata: Record<string, unknown>;
  sortOrder: number;
};

export type DatasetSummary = CataloguedDataset & {
  datasetKey: string;
  rowCount: number;
  status: "pending_review" | "ready" | "retired";
  isActive: boolean;
};

export type ReviewDatasetSummary = {
  id: string;
  title: string;
  edition: string | null;
  rowCount: number;
  visibleEntryCount: number;
  entries: {
    id: number;
    sourceRow: number;
    headword: string;
    primaryMeaning: string;
  }[];
};

export type DatasetOption = CataloguedDataset;

export type VocabUnitSummary = CataloguedUnit & {
  id: string;
  datasetId: string;
  label: string;
  kind: "day" | "supplement";
  number: number | null;
  sortIndex: number;
  entryCount: number;
};

type DatasetCatalogRow = {
  dataset_id: string;
  display_name: string;
  catalog_group: DatasetCatalogGroup;
  material_kind: DatasetMaterialKind;
  grade_code: string | null;
  publisher: string | null;
  series_title: string | null;
  academic_year: number | null;
  curriculum_revision: string | null;
  edition_label: string | null;
  is_assignable: boolean;
  sort_index: number;
};

type UnitCatalogRow = {
  unit_id: string;
  catalog_group: DatasetCatalogGroup;
  unit_type: VocabUnitType;
  display_name: string;
  academic_year: number | null;
  exam_month: number | null;
  agency: string | null;
  item_range: string | null;
  sort_index: number;
};

function cataloguedDataset(
  dataset: { id: string; title: string; edition: string | null },
  catalog: DatasetCatalogRow | undefined,
): CataloguedDataset {
  return {
    id: dataset.id,
    title: dataset.title,
    edition: dataset.edition,
    displayName:
      catalog?.display_name ??
      datasetDisplayLabel(dataset.title, dataset.edition),
    catalogGroup: catalog?.catalog_group ?? "high",
    materialKind: catalog?.material_kind ?? null,
    gradeCode: catalog?.grade_code ?? null,
    publisher: catalog?.publisher ?? null,
    seriesTitle: catalog?.series_title ?? null,
    academicYear: catalog?.academic_year ?? null,
    curriculumRevision: catalog?.curriculum_revision ?? null,
    editionLabel: catalog?.edition_label ?? null,
    isAssignable: catalog?.is_assignable ?? true,
    catalogSortIndex: catalog?.sort_index ?? 1000,
  };
}

export class StudentCreationError extends Error {
  constructor(
    public readonly reason: "dataset_unavailable" | "database",
  ) {
    super(
      reason === "dataset_unavailable"
        ? "선택한 단어장을 사용할 수 없습니다."
        : "학생과 접속코드를 만들지 못했습니다.",
    );
    this.name = "StudentCreationError";
  }
}

export class AssignmentCreationError extends Error {
  constructor(
    public readonly reason:
      | "conflict"
      | "invalid_selection"
      | "database",
    message?: string,
  ) {
    super(
      message ?? (reason === "conflict"
        ? "다른 시험에 이미 포함된 단어가 있습니다. 새로 계산된 최대 문항 수를 확인해 주세요."
        : reason === "invalid_selection"
          ? "현재 출제 가능한 범위와 문항 수를 다시 확인해 주세요."
          : "시험을 배정하지 못했습니다. 잠시 후 다시 시도해 주세요."),
    );
    this.name = "AssignmentCreationError";
  }
}

export type AssignmentSummary = {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  datasetId: string;
  datasetTitle: string;
  unitLabels: string[];
  rangeStart: number;
  rangeEnd: number;
  questionCount: number;
  englishToKoreanRatio: number;
  timeLimitSeconds: number;
  passingScore: number;
  questionOrderMode: QuestionOrderMode;
  availableUntil: string | null;
  studentCount: number;
  createdAt: string;
};

export type AttemptSummary = {
  id: string;
  studentName: string;
  assignmentTitle: string;
  attemptNumber: number;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  initialScore: number | null;
  finalScore: number | null;
  passed: boolean | null;
  questionCount: number;
  initialCorrectCount: number | null;
  retryCorrectCount: number | null;
  unresolvedWrongCount: number | null;
  startedAt: string;
  completedAt: string | null;
};

export type AdminAttemptDetail = AttemptSummary & {
  questionCount: number;
  initialCorrectCount: number | null;
  retryCorrectCount: number | null;
  unresolvedWrongCount: number | null;
  elapsedSeconds: number | null;
  questions: AttemptQuestionResult[];
};

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

type DatasetLabelRow = {
  id: string;
  title: string;
  edition: string | null;
};

type StudentCodeRow = {
  student_id: string;
  status: "active" | "blocked";
  expires_at: string | null;
};

function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function listStudents(): Promise<StudentSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [
    { data: studentData, error: studentError },
    { data: codeData },
    { data: datasetData, error: datasetError },
    catalogByDatasetId,
  ] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, display_name, school_name, grade_label, current_vocab_book, current_vocab_dataset_id, reading_curriculum_stage, reading_context_sync_status, status, code_generation, created_at",
      )
      .is("deleted_at", null)
      .order("display_name"),
    supabase.from("student_codes").select("student_id, status, expires_at"),
    supabase.from("vocab_datasets").select("id, title, edition"),
    loadDatasetCatalogMap(supabase),
  ]);

  if (studentError || datasetError) {
    throw new Error("학생 목록을 불러오지 못했습니다.");
  }

  const codeByStudent = new Map(
    ((codeData ?? []) as StudentCodeRow[]).map((code) => [
      code.student_id,
      code.status === "active" &&
      code.expires_at !== null &&
      Date.parse(code.expires_at) <= Date.now()
        ? ("expired" as const)
        : code.status,
    ]),
  );
  const datasetById = new Map(
    ((datasetData ?? []) as DatasetLabelRow[]).map((dataset) => [
      dataset.id,
      cataloguedDatasetDisplayLabel(
        cataloguedDataset(
          dataset,
          catalogByDatasetId.get(dataset.id),
        ),
      ),
    ]),
  );

  return ((studentData ?? []) as StudentRow[]).map((student) => ({
    id: student.id,
    displayName: student.display_name,
    schoolName: student.school_name,
    gradeLabel: student.grade_label,
    currentVocabBook:
      (student.current_vocab_dataset_id
        ? datasetById.get(student.current_vocab_dataset_id)
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

export async function listStudentLearningSources(): Promise<
  StudentLearningSourceSummary[]
> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [
    { data, error },
    { data: datasetData, error: datasetError },
    catalogByDatasetId,
  ] = await Promise.all([
    supabase
      .from("student_learning_sources")
      .select(
        "id, student_id, source_type, vocab_dataset_id, display_label, range_metadata, sort_order",
      )
      .eq("active", true)
      .order("sort_order")
      .order("created_at"),
    supabase.from("vocab_datasets").select("id, title, edition"),
    loadDatasetCatalogMap(supabase),
  ]);
  if (error || datasetError) {
    throw new Error("학생 학습 자료를 불러오지 못했습니다.");
  }
  const datasetById = new Map(
    ((datasetData ?? []) as DatasetLabelRow[]).map((dataset) => [
      dataset.id,
      cataloguedDatasetDisplayLabel(
        cataloguedDataset(
          dataset,
          catalogByDatasetId.get(dataset.id),
        ),
      ),
    ]),
  );
  return (data ?? []).map((source) => ({
    id: source.id as string,
    studentId: source.student_id as string,
    sourceType:
      source.source_type as StudentLearningSourceSummary["sourceType"],
    vocabDatasetId: (source.vocab_dataset_id as string | null) ?? null,
    displayLabel:
      ((source.vocab_dataset_id as string | null) &&
        datasetById.get(source.vocab_dataset_id as string)) ||
      storedDatasetDisplayLabel(source.display_label as string),
    rangeMetadata:
      source.range_metadata &&
      typeof source.range_metadata === "object" &&
      !Array.isArray(source.range_metadata)
        ? (source.range_metadata as Record<string, unknown>)
        : {},
    sortOrder: source.sort_order as number,
  }));
}

export async function createStudent(input: {
  displayName: string;
  schoolName: string;
  gradeLabel: string;
  currentVocabDatasetId: string | null;
  note: string;
}): Promise<{ studentId: string; code: string }> {
  await requireAdmin();
  const environment = getStudentCodeEnvironment();
  const supabase = await createServerSupabaseClient();
  const code = generateStudentCode();
  const encrypted = encryptStudentCode(
    code,
    environment.STUDENT_CODE_ENCRYPTION_KEY,
  );
  const { data, error } = await supabase.rpc("create_student_with_code_v2", {
    p_display_name: input.displayName,
    p_school_name: input.schoolName,
    p_grade_label: input.gradeLabel,
    p_current_vocab_dataset_id: input.currentVocabDatasetId,
    p_note: input.note,
    p_lookup_hmac: hashStudentCode(code, environment.STUDENT_CODE_PEPPER),
    p_encrypted_code: encrypted.encryptedCode,
    p_encryption_iv: encrypted.encryptionIv,
    p_encryption_tag: encrypted.encryptionTag,
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (error || !result?.student_id) {
    console.error("[student-create] database operation failed", {
      code: error?.code ?? "missing_result",
      message: error?.message ?? "student_id was not returned",
      hint: error?.hint ?? null,
    });
    if (
      error?.message.includes("dataset_not_ready") ||
      error?.message.includes("dataset_required")
    ) {
      throw new StudentCreationError("dataset_unavailable");
    }
    throw new StudentCreationError("database");
  }

  return {
    studentId: result.student_id,
    code,
  };
}

export async function setStudentCurrentDataset(
  studentId: string,
  datasetId: string | null,
): Promise<void> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc(
    "set_student_current_vocab_dataset",
    {
      p_student_id: studentId,
      p_dataset_id: datasetId,
    },
  );

  if (error) {
    throw new Error("학생의 현재 단어장을 바꾸지 못했습니다.");
  }
}

export async function updateStudentProfile(
  studentId: string,
  input: {
    displayName: string;
    schoolName: string;
    gradeLabel: string;
  },
  admin: AdminContext,
): Promise<void> {
  const supabase = getServiceSupabaseClient();
  const { data: updatedStudent, error: updateError } = await supabase
    .from("students")
    .update({
      display_name: input.displayName,
      school_name: input.schoolName || null,
      grade_label: input.gradeLabel || null,
    })
    .eq("id", studentId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (updateError || !updatedStudent) {
    throw new Error("student_profile_update_failed");
  }

  const { error: auditError } = await supabase.from("audit_events").insert({
    event_type: "student.profile_updated",
    actor_admin_id: admin.userId,
    student_id: studentId,
    details: {
      display_name: input.displayName,
      school_name: input.schoolName || null,
      grade_label: input.gradeLabel || null,
    },
  });

  if (auditError) {
    console.error("[student-profile] audit insert failed", {
      code: auditError.code,
      message: auditError.message,
      studentId,
    });
  }
}

export async function revealStudentCode(studentId: string): Promise<string> {
  const admin = await requireAdmin();
  const environment = getStudentCodeEnvironment();
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("student_codes")
    .select("encrypted_code, encryption_iv, encryption_tag, status, expires_at")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("학생코드를 불러오지 못했습니다.");
  }
  if (
    data.status !== "active" ||
    (data.expires_at !== null && Date.parse(data.expires_at) <= Date.now())
  ) {
    throw new Error("만료되었거나 차단된 코드입니다. 코드를 교체해 주세요.");
  }

  const { error: auditError } = await supabase.from("audit_events").insert({
    event_type: "student.code_revealed",
    actor_admin_id: admin.userId,
    student_id: studentId,
  });
  if (auditError) {
    throw new Error("코드 열람 기록을 저장하지 못했습니다.");
  }

  return decryptStudentCode(
    {
      encryptedCode: data.encrypted_code,
      encryptionIv: data.encryption_iv,
      encryptionTag: data.encryption_tag,
    },
    environment.STUDENT_CODE_ENCRYPTION_KEY,
  );
}

export async function rotateStudentCode(
  studentId: string,
): Promise<string> {
  await requireAdmin();
  const environment = getStudentCodeEnvironment();
  const supabase = await createServerSupabaseClient();
  const code = generateStudentCode();
  const encrypted = encryptStudentCode(
    code,
    environment.STUDENT_CODE_ENCRYPTION_KEY,
  );
  const { error } = await supabase.rpc("rotate_student_code", {
    p_student_id: studentId,
    p_lookup_hmac: hashStudentCode(code, environment.STUDENT_CODE_PEPPER),
    p_encrypted_code: encrypted.encryptedCode,
    p_encryption_iv: encrypted.encryptionIv,
    p_encryption_tag: encrypted.encryptionTag,
  });

  if (error) {
    throw new Error("학생코드를 교체하지 못했습니다.");
  }

  return code;
}

export async function setStudentStatus(
  studentId: string,
  status: "active" | "blocked",
): Promise<void> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("set_student_access_status", {
    p_student_id: studentId,
    p_status: status,
  });

  if (error) {
    throw new Error("학생 접속상태를 변경하지 못했습니다.");
  }
}

async function loadDatasetCatalogMap(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  const { data, error } = await supabase
    .from("vocab_dataset_catalog")
    .select(
      "dataset_id, display_name, catalog_group, material_kind, grade_code, publisher, series_title, academic_year, curriculum_revision, edition_label, is_assignable, sort_index",
    );

  if (error) {
    throw new Error("단어장 분류 정보를 불러오지 못했습니다.");
  }

  return new Map(
    ((data ?? []) as DatasetCatalogRow[]).map((catalog) => [
      catalog.dataset_id,
      catalog,
    ]),
  );
}

export async function listDatasets(): Promise<DatasetSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [catalogByDatasetId, { data, error }] = await Promise.all([
    loadDatasetCatalogMap(supabase),
    supabase
      .from("vocab_datasets")
      .select("id, dataset_key, title, edition, row_count, status, is_active")
      .order("title"),
  ]);

  if (error) {
    throw new Error("어휘 데이터셋을 불러오지 못했습니다.");
  }

  return (data ?? [])
    .map((dataset) => ({
      ...cataloguedDataset(
        dataset,
        catalogByDatasetId.get(dataset.id),
      ),
      datasetKey: dataset.dataset_key,
      rowCount: dataset.row_count,
      status: dataset.status,
      isActive: dataset.is_active,
    }))
    .toSorted(compareCataloguedDatasets);
}

const REVIEW_DATASET_LIMIT = 3;
const REVIEW_ENTRY_LIMIT_PER_DATASET = 12;

export async function listReviewDatasets(): Promise<
  ReviewDatasetSummary[]
> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data: datasets, error: datasetError } = await supabase
    .from("vocab_datasets")
    .select("id, title, edition, row_count")
    .eq("status", "pending_review")
    .eq("is_active", true)
    .order("imported_at", { ascending: false })
    .limit(REVIEW_DATASET_LIMIT);

  if (datasetError) {
    throw new Error("검토 중인 단어장을 불러오지 못했습니다.");
  }
  if (!datasets || datasets.length === 0) return [];

  const datasetIds = datasets.map((dataset) => dataset.id);
  const { data: entries, error: entryError } = await supabase
    .from("vocab_entries")
    .select("id, dataset_id, source_row, headword, primary_meaning")
    .in("dataset_id", datasetIds)
    .order("dataset_id")
    .order("source_row");

  if (entryError) {
    throw new Error("검토 중인 단어를 불러오지 못했습니다.");
  }

  return datasets.map((dataset) => {
    const datasetEntries = (entries ?? []).filter(
      (entry) => entry.dataset_id === dataset.id,
    );
    return {
      id: dataset.id,
      title: dataset.title,
      edition: dataset.edition,
      rowCount: dataset.row_count,
      visibleEntryCount: Math.min(
        datasetEntries.length,
        REVIEW_ENTRY_LIMIT_PER_DATASET,
      ),
      entries: datasetEntries
        .slice(0, REVIEW_ENTRY_LIMIT_PER_DATASET)
        .map((entry) => ({
          id: entry.id,
          sourceRow: entry.source_row,
          headword: entry.headword,
          primaryMeaning: entry.primary_meaning,
        })),
    };
  });
}

export async function listSelectableDatasets(): Promise<DatasetOption[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [catalogByDatasetId, { data, error }] = await Promise.all([
    loadDatasetCatalogMap(supabase),
    supabase
      .from("vocab_datasets")
      .select("id, title, edition")
      .eq("status", "ready")
      .eq("is_active", true)
      .order("title"),
  ]);

  if (error) {
    throw new Error("선택 가능한 단어장을 불러오지 못했습니다.");
  }

  return (data ?? [])
    .map((dataset) =>
      cataloguedDataset(
        dataset,
        catalogByDatasetId.get(dataset.id),
      ),
    )
    .filter((dataset) => dataset.isAssignable)
    .toSorted(compareCataloguedDatasets);
}

export async function listVocabUnits(): Promise<VocabUnitSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [
    { data, error },
    { data: catalogData, error: catalogError },
  ] = await Promise.all([
    supabase
      .from("vocab_units")
      .select(
        "id, dataset_id, unit_label, unit_kind, unit_number, sort_index, entry_count",
      )
      .order("dataset_id")
      .order("sort_index"),
    supabase
      .from("vocab_unit_catalog")
      .select(
        "unit_id, catalog_group, unit_type, display_name, academic_year, exam_month, agency, item_range, sort_index",
      ),
  ]);

  if (error || catalogError) {
    throw new Error("단어장 DAY 목록을 불러오지 못했습니다.");
  }

  const catalogByUnitId = new Map(
    ((catalogData ?? []) as UnitCatalogRow[]).map((catalog) => [
      catalog.unit_id,
      catalog,
    ]),
  );

  return (data ?? []).map((unit) => {
    const catalog = catalogByUnitId.get(unit.id);
    return {
      id: unit.id,
      datasetId: unit.dataset_id,
      label: unit.unit_label,
      kind: unit.unit_kind,
      number: unit.unit_number,
      sortIndex: unit.sort_index,
      entryCount: unit.entry_count,
      catalogGroup: catalog?.catalog_group ?? null,
      unitType: catalog?.unit_type ?? null,
      displayName: catalog?.display_name ?? unit.unit_label,
      academicYear: catalog?.academic_year ?? null,
      examMonth: catalog?.exam_month ?? null,
      agency: catalog?.agency ?? null,
      itemRange: catalog?.item_range ?? null,
      catalogSortIndex: catalog?.sort_index ?? unit.sort_index,
    };
  });
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
      throw new Error(
        "학생별 현재 단어장 오답을 불러오지 못했습니다.",
      );
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

type HistoryStudentRelation = {
  display_name: string;
  status: "active" | "blocked";
  school_name: string | null;
  grade_label: string | null;
  deleted_at: string | null;
};

type HistoryDatasetRelation = {
  title: string;
  edition: string | null;
};

type HistoryUnitRelation = {
  id: string;
  unit_label: string;
};

type HistoryAssignmentUnitRelation = {
  position: number;
  is_primary: boolean;
  unit: HistoryUnitRelation | HistoryUnitRelation[] | null;
};

type HistoryAssignmentRelation = {
  id: string;
  title: string;
  deleted_at: string | null;
  status: "draft" | "active" | "closed";
  assignment_purpose: "regular" | "review" | "mixed";
  dataset_id: string;
  range_start: number;
  range_end: number;
  range_basis: "source_rows" | "units";
  question_count: number;
  english_to_korean_ratio: number;
  time_limit_seconds: number;
  passing_score: number;
  question_order_mode: QuestionOrderMode;
  available_until: string | null;
  dataset: HistoryDatasetRelation | HistoryDatasetRelation[] | null;
  assignment_units: HistoryAssignmentUnitRelation[] | null;
};

type HistoryAssignmentStudentRow = {
  assignment_id: string;
  student_id: string;
  assigned_at: string;
  missed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  student: HistoryStudentRelation | HistoryStudentRelation[] | null;
  assignment:
    | HistoryAssignmentRelation
    | HistoryAssignmentRelation[]
    | null;
};

type HistoryAttemptRow = {
  id: string;
  assignment_id: string;
  student_id: string;
  attempt_number: number;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  question_count_snapshot: number;
  time_limit_seconds_snapshot: number;
  passing_score_snapshot: number;
  initial_correct_count: number | null;
  retry_correct_count: number | null;
  unresolved_wrong_count: number | null;
  initial_score: number | string | null;
  final_score: number | string | null;
  passed: boolean | null;
  started_at: string;
  initial_completed_at: string | null;
  retry_started_at: string | null;
  deadline_at: string;
  completed_at: string | null;
};

type HiddenHistoryEntryRow = {
  assignment_id: string;
  student_id: string;
  attempt_id: string | null;
};

const HISTORY_PAGE_SIZE = 1000;

async function listAssignmentHistorySourceRows(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  const rows: HistoryAssignmentStudentRow[] = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("assignment_students")
      .select(
        `
          assignment_id,
          student_id,
          assigned_at,
          missed_at,
          cancelled_at,
          cancellation_reason,
          student:students(display_name, status, school_name, grade_label, deleted_at),
          assignment:assignments(
            id,
            title,
            deleted_at,
            status,
            assignment_purpose,
            dataset_id,
            range_start,
            range_end,
            range_basis,
            question_count,
            english_to_korean_ratio,
            time_limit_seconds,
            passing_score,
            question_order_mode,
            available_until,
            dataset:vocab_datasets(title, edition),
            assignment_units(
              position,
              is_primary,
              unit:vocab_units(id, unit_label)
            )
          )
        `,
      )
      .order("assigned_at", { ascending: false })
      .order("assignment_id")
      .order("student_id")
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }
    const page = (data ?? []) as HistoryAssignmentStudentRow[];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

async function listAttemptHistoryRows(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  const rows: HistoryAttemptRow[] = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select(
        "id, assignment_id, student_id, attempt_number, status, phase, question_count_snapshot, time_limit_seconds_snapshot, passing_score_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, started_at, initial_completed_at, retry_started_at, deadline_at, completed_at",
      )
      .order("started_at", { ascending: false })
      .order("id")
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }
    const page = (data ?? []) as HistoryAttemptRow[];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

async function listHiddenHistoryEntries(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  const rows: HiddenHistoryEntryRow[] = [];
  for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("admin_history_hidden_entries")
      .select("assignment_id, student_id, attempt_id")
      .order("hidden_at", { ascending: false })
      .order("id")
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }
    const page = (data ?? []) as HiddenHistoryEntryRow[];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

export async function listAssignmentHistoryBundle(): Promise<{
  history: AssignmentHistorySummary[];
  completeHistory: AssignmentHistorySummary[];
  currentHistory: AssignmentHistorySummary[];
}> {
  await requireAdmin();
  await finalizeStaleQuizAttempts();
  const supabase = await createServerSupabaseClient();
  const [
    { data: assignmentStudentData, error: assignmentStudentError },
    { data: attemptData, error: attemptError },
    { data: hiddenHistoryData, error: hiddenHistoryError },
  ] = await Promise.all([
    listAssignmentHistorySourceRows(supabase),
    listAttemptHistoryRows(supabase),
    listHiddenHistoryEntries(supabase),
  ]);

  if (
    assignmentStudentError ||
    attemptError ||
    hiddenHistoryError
  ) {
    throw new Error("시험 배정과 응시 내역을 불러오지 못했습니다.");
  }
  const historyDatasets = (
    (assignmentStudentData ?? []) as HistoryAssignmentStudentRow[]
  ).flatMap((row) => {
    const assignment = oneRelation(row.assignment);
    const dataset = assignment ? oneRelation(assignment.dataset) : null;
    return assignment && dataset
      ? [{ id: assignment.dataset_id, ...dataset }]
      : [];
  });
  const datasetLabelById = await loadDatasetDisplayLabelMap(
    supabase,
    historyDatasets,
  );
  const assignmentSources = (
    (assignmentStudentData ?? []) as HistoryAssignmentStudentRow[]
  ).flatMap((row): AssignmentHistorySource[] => {
    const student = oneRelation(row.student);
    const assignment = oneRelation(row.assignment);
    if (!student || !assignment) return [];

    const dataset = oneRelation(assignment.dataset);
    const orderedUnitLinks = (assignment.assignment_units ?? [])
      .toSorted((left, right) => left.position - right.position)
      .flatMap((link) => {
        const unit = oneRelation(link.unit);
        return unit
          ? [{ unit, isPrimary: link.is_primary }]
          : [];
      });
    const orderedUnits = orderedUnitLinks.map((link) => link.unit);
    const primaryUnits = orderedUnitLinks
      .filter((link) => link.isPrimary)
      .map((link) => link.unit);
    const legacyUnitLabels =
      assignment.range_basis === "source_rows"
        ? [
            `원본 행 ${assignment.range_start.toLocaleString()}~${assignment.range_end.toLocaleString()}`,
          ]
        : [];

    return [
      {
        assignmentId: row.assignment_id,
        assignmentTitle:
          assignment.deleted_at === null ? assignment.title : "삭제됨",
        assignmentDeleted: assignment.deleted_at !== null,
        assignmentStatus: assignment.status,
        assignmentPurpose: assignment.assignment_purpose,
        studentId: row.student_id,
        studentName:
          student.deleted_at === null ? student.display_name : "삭제됨",
        studentDeleted: student.deleted_at !== null,
        studentStatus: student.status,
        schoolName:
          student.deleted_at === null ? student.school_name : null,
        gradeLabel:
          student.deleted_at === null ? student.grade_label : null,
        datasetId: assignment.dataset_id,
        datasetTitle:
          datasetLabelById.get(assignment.dataset_id) ??
          (dataset
            ? datasetDisplayLabel(dataset.title, dataset.edition)
            : "단어장"),
        unitIds: orderedUnits.map((unit) => unit.id),
        unitLabels:
          orderedUnits.length > 0
            ? orderedUnits.map((unit) => unit.unit_label)
            : legacyUnitLabels,
        primaryUnitIds: primaryUnits.map((unit) => unit.id),
        primaryUnitLabels:
          primaryUnits.length > 0
            ? primaryUnits.map((unit) => unit.unit_label)
            : assignment.assignment_purpose === "regular"
              ? legacyUnitLabels
              : [],
        questionCount: assignment.question_count,
        englishToKoreanRatio: assignment.english_to_korean_ratio,
        timeLimitSeconds: assignment.time_limit_seconds,
        passingScore: assignment.passing_score,
        questionOrderMode: assignment.question_order_mode,
        availableUntil: assignment.available_until,
        assignedAt: row.assigned_at,
        missedAt: row.missed_at,
        cancelledAt: row.cancelled_at,
        cancellationReason: row.cancellation_reason,
      },
    ];
  });

  const attemptSources = (
    (attemptData ?? []) as HistoryAttemptRow[]
  ).map(
    (attempt): AttemptHistorySource => ({
      id: attempt.id,
      assignmentId: attempt.assignment_id,
      studentId: attempt.student_id,
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      phase: attempt.phase,
      questionCount: attempt.question_count_snapshot,
      timeLimitSeconds: attempt.time_limit_seconds_snapshot,
      passingScore: attempt.passing_score_snapshot,
      initialCorrectCount: attempt.initial_correct_count,
      retryCorrectCount: attempt.retry_correct_count,
      unresolvedWrongCount: attempt.unresolved_wrong_count,
      initialScore:
        attempt.initial_score === null
          ? null
          : Number(attempt.initial_score),
      finalScore:
        attempt.final_score === null ? null : Number(attempt.final_score),
      passed: attempt.passed,
      startedAt: attempt.started_at,
      initialCompletedAt: attempt.initial_completed_at,
      retryStartedAt: attempt.retry_started_at,
      deadlineAt: attempt.deadline_at,
      completedAt: attempt.completed_at,
    }),
  );

  const hiddenAttempts = new Set<string>();
  const hiddenRecipients = new Set<string>();
  for (const hidden of (
    (hiddenHistoryData ?? []) as HiddenHistoryEntryRow[]
  )) {
    if (hidden.attempt_id) {
      hiddenAttempts.add(hidden.attempt_id);
    } else {
      hiddenRecipients.add(
        `${hidden.assignment_id}\u0000${hidden.student_id}`,
      );
    }
  }

  const completeHistory = buildAssignmentHistory(
    assignmentSources,
    attemptSources,
  );
  const completeCurrentHistory = projectCurrentAssignmentHistory(
    completeHistory,
  );
  const isVisibleHistoryItem = (item: AssignmentHistorySummary) =>
    item.attemptId
      ? !hiddenAttempts.has(item.attemptId)
      : !hiddenRecipients.has(
          `${item.assignmentId}\u0000${item.studentId}`,
        );

  return {
    completeHistory,
    currentHistory: completeCurrentHistory.filter(
      (item) =>
        isVisibleHistoryItem(item) &&
        learningActivitySection(item) !== "archived",
    ),
    history: completeHistory.filter(isVisibleHistoryItem),
  };
}

export async function listAssignmentHistory(): Promise<
  AssignmentHistorySummary[]
> {
  return (await listAssignmentHistoryBundle()).history;
}

export async function listCurrentAssignmentHistory(): Promise<
  AssignmentHistorySummary[]
> {
  return (await listAssignmentHistoryBundle()).currentHistory;
}

export type AdminHistoryDetail = {
  summary: AssignmentHistorySummary;
  attempt: AdminAttemptDetail | null;
  canonicalKey: string;
};

export async function getAdminHistoryDetail(
  entryKey: string,
): Promise<AdminHistoryDetail | null> {
  const parsed = parseHistoryEntryKey(entryKey);
  if (!parsed) return null;

  const { history } = await listAssignmentHistoryBundle();
  const summary =
    parsed.kind === "attempt"
      ? history.find((item) => item.attemptId === parsed.attemptId)
      : history.find(
          (item) =>
            item.assignmentId === parsed.assignmentId &&
            item.studentId === parsed.studentId,
        );
  if (!summary) return null;

  return {
    summary,
    attempt: summary.attemptId
      ? await getAdminAttemptDetail(summary.attemptId)
      : null,
    canonicalKey: historyEntryKey(summary),
  };
}

export type RegularAssignmentInput = {
  title: string;
  datasetId: string;
  unitIds: string[];
  questionCount: number;
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  timingMode?: TimingMode;
  questionTimeLimitSeconds?: number | null;
  passingScore: number;
  questionOrderMode: QuestionOrderMode;
  availableUntil: string | null;
  studentIds: string[];
};

export type PreparedRegularAssignment = {
  title: string;
  datasetId: string;
  unitIds: string[];
  questionCount: number;
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  passingScore: number;
  questionOrderMode: QuestionOrderMode;
  availableUntil: string | null;
  studentIds: string[];
  questions: {
    vocab_entry_id: number;
    base_order_index: number;
    direction: "english_to_korean" | "korean_to_english";
    choice_vocab_entry_ids: number[];
  }[];
};

export async function prepareRegularAssignment(
  input: RegularAssignmentInput,
  authenticatedAdmin?: AdminContext,
  exclusion?: {
    assignmentId: string;
    studentId: string;
  },
): Promise<PreparedRegularAssignment> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  const supabase = await createServerSupabaseClient();
  const [
    { data: dataset, error: datasetError },
    { data: unitData, error: unitError },
  ] = await Promise.all([
    supabase
      .from("vocab_datasets")
      .select("id, title, edition")
      .eq("id", input.datasetId)
      .eq("status", "ready")
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("vocab_units")
      .select("id, unit_label, sort_index")
      .eq("dataset_id", input.datasetId)
      .in("id", input.unitIds)
      .order("sort_index"),
  ]);

  if (
    datasetError ||
    unitError ||
    !dataset ||
    !unitData ||
    unitData.length !== input.unitIds.length
  ) {
    throw new Error("선택한 단어장과 DAY를 사용할 수 없습니다.");
  }

  let orderedUnits: typeof unitData;
  try {
    orderedUnits = resolveOrderedContiguousUnits(
      unitData.map((unit) => ({
        ...unit,
        sortIndex: unit.sort_index,
      })),
      input.unitIds,
    );
  } catch {
    throw new AssignmentCreationError(
      "invalid_selection",
      "선택한 DAY는 한 방향으로 이어지는 연속 범위여야 합니다.",
    );
  }
  const orderedUnitIds = orderedUnits.map((unit) => unit.id);
  const [allCandidates, activeAssignments] = await Promise.all([
    loadEligibleVocabularyDataset(supabase, input.datasetId, {
      includeExamUseProjection: true,
    }),
    loadActiveReviewAssignments(
      supabase,
      input.studentIds,
      input.datasetId,
      exclusion,
    ),
  ]);
  const unitIdSet = new Set(orderedUnitIds);
  const primaryCandidates = allCandidates.filter(
    (candidate) =>
      unitIdSet.has(candidate.unitId) &&
      !activeReviewIdentities(
          candidate.id,
          candidate.canonicalLexemeId,
          candidate.headwordNormalized,
          candidate.canonicalDictionaryId,
        ).some((identity) => activeAssignments.identities.has(identity)),
  );
  const sourceOrderByCandidateId = new Map(
    allCandidates.map((candidate) => [
      candidate.id,
      candidate.sourceRow,
    ]),
  );
  const unitIdByCandidateId = new Map(
    allCandidates.map((candidate) => [candidate.id, candidate.unitId]),
  );
  const unitPositionById = new Map(
    orderedUnitIds.map((unitId, index) => [unitId, index]),
  );
  let questionDrafts: ReturnType<typeof createMixedQuizQuestions>;
  try {
    questionDrafts = createMixedQuizQuestions(
      [],
      primaryCandidates,
      primaryCandidates,
      input.questionCount,
      input.englishToKoreanRatio,
    );
  } catch {
    throw new AssignmentCreationError(
      "invalid_selection",
      `선택한 범위에서는 ${input.questionCount}문항을 만들 수 없습니다. 문항 수를 줄이거나 출제 방식을 바꿔주세요.`,
    );
  }
  questionDrafts.sort(
    (left, right) =>
      (unitPositionById.get(
        unitIdByCandidateId.get(left.vocabEntryId) ?? "",
      ) ?? Number.MAX_SAFE_INTEGER) -
        (unitPositionById.get(
          unitIdByCandidateId.get(right.vocabEntryId) ?? "",
        ) ?? Number.MAX_SAFE_INTEGER) ||
      (sourceOrderByCandidateId.get(left.vocabEntryId) ?? 0) -
        (sourceOrderByCandidateId.get(right.vocabEntryId) ?? 0),
  );
  const unitRangeLabel =
    orderedUnits.length === 1
      ? orderedUnits[0].unit_label
      : `${orderedUnits[0].unit_label}~${orderedUnits.at(-1)?.unit_label}`;
  const datasetLabel = await loadDatasetDisplayLabel(supabase, dataset);
  const generatedTitle = [datasetLabel, unitRangeLabel].join(" · ");

  return {
    title: input.title || generatedTitle,
    datasetId: input.datasetId,
    unitIds: orderedUnitIds,
    questionCount: input.questionCount,
    englishToKoreanRatio: input.englishToKoreanRatio,
    timeLimitSeconds: input.timeLimitSeconds,
    timingMode: input.timingMode ?? "total",
    questionTimeLimitSeconds:
      input.timingMode === "per_question"
        ? (input.questionTimeLimitSeconds ?? null)
        : null,
    passingScore: input.passingScore,
    questionOrderMode: input.questionOrderMode,
    availableUntil: input.availableUntil,
    studentIds: input.studentIds,
    questions: questionDrafts.map((question, index) => ({
      vocab_entry_id: question.vocabEntryId,
      base_order_index: index + 1,
      direction: question.direction,
      choice_vocab_entry_ids: question.choiceVocabEntryIds,
    })),
  };
}

export async function createAssignment(
  input: RegularAssignmentInput,
): Promise<string> {
  const authenticatedAdmin = await requireAdmin();
  const prepared = await prepareRegularAssignment(
    input,
    authenticatedAdmin,
  );
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "create_assignment_with_delivery_v6",
    {
      p_title: prepared.title,
      p_dataset_id: prepared.datasetId,
      p_unit_ids: prepared.unitIds,
      p_question_count: prepared.questionCount,
      p_english_to_korean_ratio: prepared.englishToKoreanRatio,
      p_time_limit_seconds: prepared.timeLimitSeconds,
      p_passing_score: prepared.passingScore,
      p_question_order_mode: prepared.questionOrderMode,
      p_available_until: prepared.availableUntil,
      p_student_ids: prepared.studentIds,
      p_timing_mode: prepared.timingMode,
      p_question_time_limit_seconds:
        prepared.questionTimeLimitSeconds,
      p_questions: prepared.questions,
    },
  );

  if (error || typeof data !== "string") {
    console.error("[regular-assignment] database operation failed", {
      code: error?.code ?? "missing_result",
      message: error?.message ?? "assignment id was not returned",
      hint: error?.hint ?? null,
    });
    throw new AssignmentCreationError(
      error?.code === "40001"
        ? "conflict"
        : ["21000", "22023", "23503", "23505"].includes(
              error?.code ?? "",
            )
          ? "invalid_selection"
          : "database",
    );
  }

  return data;
}

export async function listAssignments(): Promise<AssignmentSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [
    { data, error },
    { data: assignmentStudentData, error: studentLinkError },
    { data: assignmentUnitData, error: unitLinkError },
    { data: unitData, error: unitError },
    { data: datasetData, error: datasetError },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "id, title, status, dataset_id, range_start, range_end, question_count, english_to_korean_ratio, time_limit_seconds, passing_score, question_order_mode, available_until, created_at",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("assignment_students").select("assignment_id"),
    supabase
      .from("assignment_units")
      .select("assignment_id, unit_id, position")
      .order("position"),
    supabase.from("vocab_units").select("id, unit_label"),
    supabase.from("vocab_datasets").select("id, title, edition"),
  ]);

  if (
    error ||
    studentLinkError ||
    unitLinkError ||
    unitError ||
    datasetError
  ) {
    throw new Error("시험 배정 목록을 불러오지 못했습니다.");
  }

  const studentCounts = new Map<string, number>();
  for (const row of assignmentStudentData ?? []) {
    studentCounts.set(
      row.assignment_id,
      (studentCounts.get(row.assignment_id) ?? 0) + 1,
    );
  }
  const unitLabelById = new Map(
    (unitData ?? []).map((unit) => [unit.id, unit.unit_label]),
  );
  const unitLabelsByAssignment = new Map<string, string[]>();
  for (const link of assignmentUnitData ?? []) {
    const labels = unitLabelsByAssignment.get(link.assignment_id) ?? [];
    const label = unitLabelById.get(link.unit_id);
    if (label) labels.push(label);
    unitLabelsByAssignment.set(link.assignment_id, labels);
  }
  const datasetTitleById = await loadDatasetDisplayLabelMap(
    supabase,
    datasetData ?? [],
  );

  return (data ?? []).map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    status: assignment.status,
    datasetId: assignment.dataset_id,
    datasetTitle:
      datasetTitleById.get(assignment.dataset_id) ?? "단어장",
    unitLabels: unitLabelsByAssignment.get(assignment.id) ?? [],
    rangeStart: assignment.range_start,
    rangeEnd: assignment.range_end,
    questionCount: assignment.question_count,
    englishToKoreanRatio: assignment.english_to_korean_ratio,
    timeLimitSeconds: assignment.time_limit_seconds,
    passingScore: assignment.passing_score,
    questionOrderMode: assignment.question_order_mode,
    availableUntil: assignment.available_until,
    studentCount: studentCounts.get(assignment.id) ?? 0,
    createdAt: assignment.created_at,
  }));
}

export async function listAttempts(): Promise<AttemptSummary[]> {
  await requireAdmin();
  await finalizeStaleQuizAttempts();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select(
      "id, attempt_number, status, phase, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, started_at, completed_at, students(display_name, deleted_at), assignments(title, deleted_at)",
    )
    .order("started_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error("시험 결과를 불러오지 못했습니다.");
  }

  return (data ?? []).map((attempt) => {
    const student = Array.isArray(attempt.students)
      ? attempt.students[0]
      : attempt.students;
    const assignment = Array.isArray(attempt.assignments)
      ? attempt.assignments[0]
      : attempt.assignments;

    return {
      id: attempt.id,
      studentName:
        !student
          ? "알 수 없음"
          : student.deleted_at === null
            ? student.display_name
            : "삭제됨",
      assignmentTitle:
        !assignment
          ? "알 수 없음"
          : assignment.deleted_at === null
            ? assignment.title
            : "삭제됨",
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      phase: attempt.phase,
      initialScore:
        attempt.initial_score === null ? null : Number(attempt.initial_score),
      finalScore:
        attempt.final_score === null ? null : Number(attempt.final_score),
      passed: attempt.passed,
      questionCount: attempt.question_count_snapshot,
      initialCorrectCount: attempt.initial_correct_count,
      retryCorrectCount: attempt.retry_correct_count,
      unresolvedWrongCount: attempt.unresolved_wrong_count,
      startedAt: attempt.started_at,
      completedAt: attempt.completed_at,
    };
  });
}

export async function getAdminAttemptDetail(
  attemptId: string,
  authenticatedAdmin?: AdminContext,
): Promise<AdminAttemptDetail | null> {
  if (!authenticatedAdmin) {
    await requireAdmin();
  }
  await finalizeQuizAttemptIfStale(attemptId);
  const supabase = getServiceSupabaseClient();
  const [{ data, error }, questions] = await Promise.all([
    supabase
      .from("quiz_attempts")
      .select(
        "id, attempt_number, status, phase, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, elapsed_seconds, started_at, initial_completed_at, completed_at, students(display_name, deleted_at), assignments(title, deleted_at)",
      )
      .eq("id", attemptId)
      .maybeSingle(),
    getAttemptQuestionResults(attemptId),
  ]);

  if (error || !data) {
    return null;
  }

  const student = Array.isArray(data.students)
    ? data.students[0]
    : data.students;
  const assignment = Array.isArray(data.assignments)
    ? data.assignments[0]
    : data.assignments;
  const reviewing =
    data.status === "in_progress" && data.phase === "review";
  const reviewMetrics = reviewing
    ? deriveAttemptQuestionMetrics(questions)
    : null;
  const reviewElapsedSeconds =
    reviewing && data.initial_completed_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(data.initial_completed_at).getTime() -
              new Date(data.started_at).getTime()) /
              1000,
          ),
        )
      : null;

  return {
    id: data.id,
    studentName:
      !student
        ? "알 수 없음"
        : student.deleted_at === null
          ? student.display_name
          : "삭제됨",
    assignmentTitle:
      !assignment
        ? "알 수 없음"
        : assignment.deleted_at === null
          ? assignment.title
          : "삭제됨",
    attemptNumber: data.attempt_number,
    status: data.status,
    phase: data.phase,
    initialScore:
      reviewMetrics?.initialScore ??
      (data.initial_score === null ? null : Number(data.initial_score)),
    finalScore: data.final_score === null ? null : Number(data.final_score),
    passed: data.passed,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    questionCount: data.question_count_snapshot,
    initialCorrectCount:
      reviewMetrics?.initialCorrectCount ?? data.initial_correct_count,
    retryCorrectCount:
      reviewMetrics?.retryCorrectCount ?? data.retry_correct_count,
    unresolvedWrongCount:
      reviewMetrics?.unresolvedWrongCount ??
      data.unresolved_wrong_count,
    elapsedSeconds: reviewElapsedSeconds ?? data.elapsed_seconds,
    questions,
  };
}
