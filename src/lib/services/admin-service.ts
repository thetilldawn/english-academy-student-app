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
import {
  createQuizQuestions,
  type QuizVocabularyEntry,
} from "@/lib/quiz/engine";

export type StudentSummary = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
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

export type VocabUnitSummary = {
  id: string;
  datasetId: string;
  label: string;
  kind: "day" | "supplement";
  number: number | null;
  sortIndex: number;
  entryCount: number;
};

export type StudentProgressSummary = {
  studentId: string;
  latestAttemptId: string | null;
  latestAssignmentTitle: string | null;
  latestStatus: "in_progress" | "completed" | "expired" | null;
  latestScore: number | null;
  latestPassed: boolean | null;
  latestUnitLabel: string | null;
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendedUnitLabel: string | null;
  recommendationReason:
    | "first"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
    | null;
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
  datasetTitle: string;
  unitLabels: string[];
  rangeStart: number;
  rangeEnd: number;
  questionCount: number;
  englishToKoreanRatio: number;
  timeLimitSeconds: number;
  passingScore: number;
  questionOrderMode: "fixed" | "random";
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
    currentVocabDatasetId: student.current_vocab_dataset_id,
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

export async function listVocabUnits(): Promise<VocabUnitSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vocab_units")
    .select(
      "id, dataset_id, unit_label, unit_kind, unit_number, sort_index, entry_count",
    )
    .order("dataset_id")
    .order("sort_index");

  if (error) {
    throw new Error("단어장 DAY 목록을 불러오지 못했습니다.");
  }

  return (data ?? []).map((unit) => ({
    id: unit.id,
    datasetId: unit.dataset_id,
    label: unit.unit_label,
    kind: unit.unit_kind,
    number: unit.unit_number,
    sortIndex: unit.sort_index,
    entryCount: unit.entry_count,
  }));
}

export async function listStudentProgress(
  students: StudentSummary[],
  units: VocabUnitSummary[],
): Promise<StudentProgressSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [
    { data: attemptData, error: attemptError },
    { data: assignmentData, error: assignmentError },
    { data: assignmentUnitData, error: assignmentUnitError },
  ] = await Promise.all([
    supabase
      .from("quiz_attempts")
      .select(
        "id, student_id, assignment_id, status, initial_score, final_score, passed, started_at",
      )
      .order("started_at", { ascending: false })
      .limit(1000),
    supabase.from("assignments").select("id, dataset_id, title"),
    supabase
      .from("assignment_units")
      .select("assignment_id, unit_id, position")
      .order("position"),
  ]);

  if (attemptError || assignmentError || assignmentUnitError) {
    throw new Error("학생별 단어 시험 진도를 불러오지 못했습니다.");
  }

  type ProgressAttemptRow = {
    id: string;
    student_id: string;
    assignment_id: string;
    status: "in_progress" | "completed" | "expired";
    initial_score: number | string | null;
    final_score: number | string | null;
    passed: boolean | null;
    started_at: string;
  };
  type ProgressAssignmentRow = {
    id: string;
    dataset_id: string;
    title: string;
  };
  type ProgressAssignmentUnitRow = {
    assignment_id: string;
    unit_id: string;
    position: number;
  };

  const studentById = new Map(
    students.map((student) => [student.id, student]),
  );
  const assignmentById = new Map(
    ((assignmentData ?? []) as ProgressAssignmentRow[]).map(
      (assignment) => [assignment.id, assignment],
    ),
  );
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const unitLinksByAssignment = new Map<
    string,
    ProgressAssignmentUnitRow[]
  >();
  for (const link of (assignmentUnitData ??
    []) as ProgressAssignmentUnitRow[]) {
    const links = unitLinksByAssignment.get(link.assignment_id) ?? [];
    links.push(link);
    unitLinksByAssignment.set(link.assignment_id, links);
  }
  for (const links of unitLinksByAssignment.values()) {
    links.sort((left, right) => left.position - right.position);
  }

  const latestAttemptByStudent = new Map<string, ProgressAttemptRow>();
  for (const attempt of (attemptData ?? []) as ProgressAttemptRow[]) {
    if (latestAttemptByStudent.has(attempt.student_id)) continue;
    const student = studentById.get(attempt.student_id);
    const assignment = assignmentById.get(attempt.assignment_id);
    if (!student || !assignment) continue;
    if (
      student.currentVocabDatasetId &&
      assignment.dataset_id !== student.currentVocabDatasetId
    ) {
      continue;
    }
    latestAttemptByStudent.set(attempt.student_id, attempt);
  }

  return students.map((student) => {
    const latestAttempt = latestAttemptByStudent.get(student.id) ?? null;
    const latestAssignment = latestAttempt
      ? assignmentById.get(latestAttempt.assignment_id) ?? null
      : null;
    const latestUnitLinks = latestAttempt
      ? unitLinksByAssignment.get(latestAttempt.assignment_id) ?? []
      : [];
    const latestUnits = latestUnitLinks
      .map((link) => unitById.get(link.unit_id))
      .filter((unit): unit is VocabUnitSummary => Boolean(unit));
    const latestUnitLabel =
      latestUnits.length === 0
        ? null
        : latestUnits.length === 1
          ? latestUnits[0].label
          : `${latestUnits[0].label}~${latestUnits.at(-1)?.label}`;
    const datasetUnits = student.currentVocabDatasetId
      ? units
          .filter(
            (unit) =>
              unit.datasetId === student.currentVocabDatasetId,
          )
          .sort((left, right) => left.sortIndex - right.sortIndex)
      : [];

    let recommendedUnit: VocabUnitSummary | null =
      datasetUnits[0] ?? null;
    let recommendationReason:
      | StudentProgressSummary["recommendationReason"] =
      recommendedUnit ? "first" : null;

    if (latestAttempt && latestAssignment && datasetUnits.length > 0) {
      const firstLatestUnit = latestUnits[0] ?? null;
      const lastLatestUnit = latestUnits.at(-1) ?? null;
      if (latestAttempt.status === "in_progress") {
        recommendedUnit = firstLatestUnit ?? datasetUnits[0];
        recommendationReason = "resume";
      } else if (
        latestAttempt.status === "completed" &&
        latestAttempt.passed === true
      ) {
        if (lastLatestUnit) {
          const lastIndex = datasetUnits.findIndex(
            (unit) => unit.id === lastLatestUnit.id,
          );
          recommendedUnit =
            lastIndex >= 0
              ? (datasetUnits[lastIndex + 1] ?? null)
              : null;
          recommendationReason = recommendedUnit ? "next" : "complete";
        } else {
          recommendedUnit = datasetUnits[0];
          recommendationReason = "first";
        }
      } else {
        recommendedUnit = firstLatestUnit ?? datasetUnits[0];
        recommendationReason = "repeat";
      }
    }

    const rawScore =
      latestAttempt?.final_score ?? latestAttempt?.initial_score ?? null;
    return {
      studentId: student.id,
      latestAttemptId: latestAttempt?.id ?? null,
      latestAssignmentTitle: latestAssignment?.title ?? null,
      latestStatus: latestAttempt?.status ?? null,
      latestScore: rawScore === null ? null : Number(rawScore),
      latestPassed: latestAttempt?.passed ?? null,
      latestUnitLabel,
      recommendedDatasetId: student.currentVocabDatasetId,
      recommendedUnitId: recommendedUnit?.id ?? null,
      recommendedUnitLabel: recommendedUnit?.label ?? null,
      recommendationReason,
    };
  });
}

export async function createAssignment(input: {
  title: string;
  datasetId: string;
  unitIds: string[];
  questionCount: number;
  englishToKoreanRatio: 0 | 50 | 100;
  timeLimitSeconds: number;
  passingScore: number;
  questionOrderMode: "fixed" | "random";
  studentIds: string[];
}): Promise<string> {
  await requireAdmin();
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

  const sortedUnits = [...unitData].sort(
    (left, right) => left.sort_index - right.sort_index,
  );
  const orderedUnitIds = sortedUnits.map((unit) => unit.id);
  const entryData: Array<{
    id: number;
    source_row: number;
    headword: string;
    headword_normalized: string;
    primary_meaning: string;
  }> = [];
  const eligibleDirectionsByEntry = new Map<
    number,
    Set<"english_to_korean" | "korean_to_english">
  >();
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data: page, error: entryError } = await supabase
      .from("vocab_entries")
      .select(
        "id, source_row, headword, headword_normalized, primary_meaning",
      )
      .eq("dataset_id", input.datasetId)
      .in("unit_id", orderedUnitIds)
      .order("source_row")
      .range(offset, offset + pageSize - 1);

    if (entryError) {
      throw new Error("선택한 DAY의 단어를 불러오지 못했습니다.");
    }
    entryData.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
  }

  for (let offset = 0; ; offset += pageSize) {
    const { data: page, error: eligibilityError } = await supabase
      .from("vocab_entry_quiz_eligibility")
      .select("vocab_entry_id, quiz_mode")
      .eq("dataset_id", input.datasetId)
      .eq("status", "eligible")
      .order("vocab_entry_id")
      .order("quiz_mode")
      .range(offset, offset + pageSize - 1);

    if (eligibilityError) {
      throw new Error("단어시험 사용 가능 상태를 불러오지 못했습니다.");
    }
    for (const row of page ?? []) {
      const directions =
        eligibleDirectionsByEntry.get(row.vocab_entry_id) ??
        new Set<"english_to_korean" | "korean_to_english">();
      directions.add(
        row.quiz_mode === "book_meaning_en_to_ko"
          ? "english_to_korean"
          : "korean_to_english",
      );
      eligibleDirectionsByEntry.set(row.vocab_entry_id, directions);
    }
    if (!page || page.length < pageSize) break;
  }

  const uniqueEntries = new Map<string, QuizVocabularyEntry>();
  const sourceOrderById = new Map<number, number>();
  for (const entry of entryData) {
    const eligibleDirections = [
      ...(eligibleDirectionsByEntry.get(entry.id) ?? []),
    ];
    if (eligibleDirections.length === 0) continue;
    const key = entry.headword_normalized
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replaceAll("*", "");
    if (!uniqueEntries.has(key)) {
      uniqueEntries.set(key, {
        id: entry.id,
        headword: entry.headword,
        primaryMeaning: entry.primary_meaning,
        eligibleDirections,
      });
      sourceOrderById.set(entry.id, entry.source_row);
    }
  }

  const questionDrafts = createQuizQuestions(
    [...uniqueEntries.values()],
    input.questionCount,
    input.englishToKoreanRatio,
  ).sort(
    (left, right) =>
      (sourceOrderById.get(left.vocabEntryId) ?? 0) -
      (sourceOrderById.get(right.vocabEntryId) ?? 0),
  );
  const unitRangeLabel =
    sortedUnits.length === 1
      ? sortedUnits[0].unit_label
      : `${sortedUnits[0].unit_label}~${sortedUnits.at(-1)?.unit_label}`;
  const generatedTitle = [
    dataset.title,
    dataset.edition,
    unitRangeLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const { data, error } = await supabase.rpc(
    "create_assignment_with_question_bank_v2",
    {
      p_title: input.title || generatedTitle,
      p_dataset_id: input.datasetId,
      p_unit_ids: orderedUnitIds,
      p_question_count: input.questionCount,
      p_english_to_korean_ratio: input.englishToKoreanRatio,
      p_time_limit_seconds: input.timeLimitSeconds,
      p_passing_score: input.passingScore,
      p_question_order_mode: input.questionOrderMode,
      p_student_ids: input.studentIds,
      p_questions: questionDrafts.map((question, index) => ({
        vocab_entry_id: question.vocabEntryId,
        base_order_index: index + 1,
        direction: question.direction,
        choice_vocab_entry_ids: question.choiceVocabEntryIds,
      })),
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
        "id, title, status, dataset_id, range_start, range_end, question_count, english_to_korean_ratio, time_limit_seconds, passing_score, question_order_mode, created_at",
      )
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
  const datasetTitleById = new Map(
    (datasetData ?? []).map((dataset) => [
      dataset.id,
      [dataset.title, dataset.edition].filter(Boolean).join(" · "),
    ]),
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
      "id, attempt_number, status, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, started_at, completed_at, students(display_name), assignments(title)",
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
