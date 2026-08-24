import "server-only";

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
import { getStudentCodeEnvironment } from "@/lib/env";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
