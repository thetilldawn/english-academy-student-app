import "server-only";

import { getStudentCodeEnvironment } from "@/lib/env";
import { requireAdmin } from "@/lib/auth/admin";
import {
  decryptStudentCode,
  encryptStudentCode,
  generateStudentCode,
  hashStudentCode,
} from "@/lib/auth/student-code";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import {
  getAttemptQuestionResults,
  type AttemptQuestionResult,
} from "@/lib/services/quiz-service";

export type StudentSummary = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  status: "active" | "blocked";
  codeGeneration: number;
  codeStatus: "active" | "blocked" | "missing";
  createdAt: string;
};

export type DatasetSummary = {
  id: string;
  datasetKey: string;
  title: string;
  edition: string | null;
  rowCount: number;
  status: "pending_review" | "ready" | "retired";
  isActive: boolean;
};

export type DatasetOption = {
  id: string;
  title: string;
  edition: string | null;
};

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

export type AssignmentSummary = {
  id: string;
  title: string;
  status: "draft" | "active" | "closed";
  datasetId: string;
  rangeStart: number;
  rangeEnd: number;
  questionCount: number;
  timeLimitSeconds: number;
  passingScore: number;
  retakeAllowed: boolean;
  studentCount: number;
  createdAt: string;
};

export type AttemptSummary = {
  id: string;
  studentName: string;
  assignmentTitle: string;
  attemptNumber: number;
  status: "in_progress" | "completed" | "expired";
  initialScore: number | null;
  finalScore: number | null;
  passed: boolean | null;
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
};

export async function listStudents(): Promise<StudentSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [
    { data: studentData, error: studentError },
    { data: codeData },
    { data: datasetData, error: datasetError },
  ] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, display_name, school_name, grade_label, current_vocab_book, current_vocab_dataset_id, status, code_generation, created_at",
      )
      .order("display_name"),
    supabase.from("student_codes").select("student_id, status"),
    supabase.from("vocab_datasets").select("id, title, edition"),
  ]);

  if (studentError || datasetError) {
    throw new Error("학생 목록을 불러오지 못했습니다.");
  }

  const codeByStudent = new Map(
    ((codeData ?? []) as StudentCodeRow[]).map((code) => [
      code.student_id,
      code.status,
    ]),
  );
  const datasetById = new Map(
    ((datasetData ?? []) as DatasetLabelRow[]).map((dataset) => [
      dataset.id,
      [dataset.title, dataset.edition].filter(Boolean).join(" · "),
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
      student.current_vocab_book,
    status: student.status,
    codeGeneration: student.code_generation,
    codeStatus: codeByStudent.get(student.id) ?? "missing",
    createdAt: student.created_at,
  }));
}

export async function createStudent(input: {
  displayName: string;
  schoolName: string;
  gradeLabel: string;
  currentVocabDatasetId: string;
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

export async function revealStudentCode(studentId: string): Promise<string> {
  const admin = await requireAdmin();
  const environment = getStudentCodeEnvironment();
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("student_codes")
    .select("encrypted_code, encryption_iv, encryption_tag")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("학생코드를 불러오지 못했습니다.");
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

export async function listDatasets(): Promise<DatasetSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vocab_datasets")
    .select("id, dataset_key, title, edition, row_count, status, is_active")
    .order("title");

  if (error) {
    throw new Error("어휘 데이터셋을 불러오지 못했습니다.");
  }

  return (data ?? []).map((dataset) => ({
    id: dataset.id,
    datasetKey: dataset.dataset_key,
    title: dataset.title,
    edition: dataset.edition,
    rowCount: dataset.row_count,
    status: dataset.status,
    isActive: dataset.is_active,
  }));
}

export async function listSelectableDatasets(): Promise<DatasetOption[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vocab_datasets")
    .select("id, title, edition")
    .eq("status", "ready")
    .eq("is_active", true)
    .order("title");

  if (error) {
    throw new Error("선택 가능한 단어장을 불러오지 못했습니다.");
  }

  return (data ?? []).map((dataset) => ({
    id: dataset.id,
    title: dataset.title,
    edition: dataset.edition,
  }));
}

export async function createAssignment(input: {
  title: string;
  datasetId: string;
  rangeStart: number;
  rangeEnd: number;
  questionCount: number;
  timeLimitSeconds: number;
  passingScore: number;
  retakeAllowed: boolean;
  studentIds: string[];
}): Promise<string> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "create_assignment_with_students",
    {
      p_title: input.title,
      p_dataset_id: input.datasetId,
      p_range_start: input.rangeStart,
      p_range_end: input.rangeEnd,
      p_question_count: input.questionCount,
      p_time_limit_seconds: input.timeLimitSeconds,
      p_passing_score: input.passingScore,
      p_retake_allowed: input.retakeAllowed,
      p_student_ids: input.studentIds,
    },
  );

  if (error || typeof data !== "string") {
    throw new Error("시험을 배정하지 못했습니다.");
  }

  return data;
}

export async function listAssignments(): Promise<AssignmentSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [{ data, error }, { data: assignmentStudentData }] =
    await Promise.all([
      supabase
        .from("assignments")
        .select(
          "id, title, status, dataset_id, range_start, range_end, question_count, time_limit_seconds, passing_score, retake_allowed, created_at",
        )
        .order("created_at", { ascending: false }),
      supabase.from("assignment_students").select("assignment_id"),
    ]);

  if (error) {
    throw new Error("시험 배정 목록을 불러오지 못했습니다.");
  }

  const studentCounts = new Map<string, number>();
  for (const row of assignmentStudentData ?? []) {
    studentCounts.set(
      row.assignment_id,
      (studentCounts.get(row.assignment_id) ?? 0) + 1,
    );
  }

  return (data ?? []).map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    status: assignment.status,
    datasetId: assignment.dataset_id,
    rangeStart: assignment.range_start,
    rangeEnd: assignment.range_end,
    questionCount: assignment.question_count,
    timeLimitSeconds: assignment.time_limit_seconds,
    passingScore: assignment.passing_score,
    retakeAllowed: assignment.retake_allowed,
    studentCount: studentCounts.get(assignment.id) ?? 0,
    createdAt: assignment.created_at,
  }));
}

export async function listAttempts(): Promise<AttemptSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select(
      "id, attempt_number, status, initial_score, final_score, passed, started_at, completed_at, students(display_name), assignments(title)",
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
      studentName: student?.display_name ?? "알 수 없음",
      assignmentTitle: assignment?.title ?? "알 수 없음",
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      initialScore:
        attempt.initial_score === null ? null : Number(attempt.initial_score),
      finalScore:
        attempt.final_score === null ? null : Number(attempt.final_score),
      passed: attempt.passed,
      startedAt: attempt.started_at,
      completedAt: attempt.completed_at,
    };
  });
}

export async function getAdminAttemptDetail(
  attemptId: string,
): Promise<AdminAttemptDetail | null> {
  await requireAdmin();
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select(
      "id, attempt_number, status, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, elapsed_seconds, started_at, completed_at, students(display_name), assignments(title)",
    )
    .eq("id", attemptId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const student = Array.isArray(data.students)
    ? data.students[0]
    : data.students;
  const assignment = Array.isArray(data.assignments)
    ? data.assignments[0]
    : data.assignments;

  return {
    id: data.id,
    studentName: student?.display_name ?? "알 수 없음",
    assignmentTitle: assignment?.title ?? "알 수 없음",
    attemptNumber: data.attempt_number,
    status: data.status,
    initialScore:
      data.initial_score === null ? null : Number(data.initial_score),
    finalScore: data.final_score === null ? null : Number(data.final_score),
    passed: data.passed,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    questionCount: data.question_count_snapshot,
    initialCorrectCount: data.initial_correct_count,
    retryCorrectCount: data.retry_correct_count,
    unresolvedWrongCount: data.unresolved_wrong_count,
    elapsedSeconds: data.elapsed_seconds,
    questions: await getAttemptQuestionResults(attemptId),
  };
}
