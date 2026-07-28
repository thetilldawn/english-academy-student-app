import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { STUDENT_SESSION_MAX_AGE_SECONDS } from "@/lib/constants";
import { getServerEnvironment } from "@/lib/env";
import {
  generateStudentSessionToken,
  getStudentCookieName,
  getStudentCookieOptions,
  hashStudentSessionToken,
} from "@/lib/auth/student-code";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

export type StudentSession = {
  sessionId: string;
  studentId: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  expiresAt: string;
};

type SessionRow = {
  id: string;
  student_id: string;
  code_generation: number;
  expires_at: string;
  revoked_at: string | null;
};

type StudentRow = {
  id: string;
  display_name: string;
  school_name: string | null;
  grade_label: string | null;
  status: "active" | "blocked";
  code_generation: number;
};

export async function validateStudentSessionToken(
  token: string,
): Promise<StudentSession | null> {
  const environment = getServerEnvironment();
  const tokenHash = hashStudentSessionToken(
    token,
    environment.STUDENT_SESSION_PEPPER,
  );
  const supabase = getServiceSupabaseClient();

  const { data: sessionData, error: sessionError } = await supabase
    .from("student_sessions")
    .select("id, student_id, code_generation, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  const session = sessionData as SessionRow | null;

  if (
    sessionError ||
    !session ||
    session.revoked_at ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  const { data: studentData, error: studentError } = await supabase
    .from("students")
    .select(
      "id, display_name, school_name, grade_label, status, code_generation",
    )
    .eq("id", session.student_id)
    .maybeSingle();
  const student = studentData as StudentRow | null;

  if (
    studentError ||
    !student ||
    student.status !== "active" ||
    student.code_generation !== session.code_generation
  ) {
    return null;
  }

  return {
    sessionId: session.id,
    studentId: student.id,
    displayName: student.display_name,
    schoolName: student.school_name,
    gradeLabel: student.grade_label,
    expiresAt: session.expires_at,
  };
}

export const getStudentSession = cache(
  async (): Promise<StudentSession | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(getStudentCookieName())?.value;

  if (!token) {
    return null;
  }

  return validateStudentSessionToken(token);
  },
);

export async function requireStudentSession(): Promise<StudentSession> {
  const session = await getStudentSession();

  if (!session) {
    redirect("/code");
  }

  return session;
}

export async function issueStudentSession(input: {
  studentId: string;
  codeGeneration: number;
  userAgentHash: string | null;
}): Promise<string> {
  const environment = getServerEnvironment();
  const token = generateStudentSessionToken();
  const tokenHash = hashStudentSessionToken(
    token,
    environment.STUDENT_SESSION_PEPPER,
  );
  const expiresAt = new Date(
    Date.now() + STUDENT_SESSION_MAX_AGE_SECONDS * 1000,
  ).toISOString();
  const supabase = getServiceSupabaseClient();

  const { error } = await supabase.from("student_sessions").insert({
    student_id: input.studentId,
    token_hash: tokenHash,
    code_generation: input.codeGeneration,
    expires_at: expiresAt,
    user_agent_hash: input.userAgentHash,
  });

  if (error) {
    throw new Error("학생 세션을 발급하지 못했습니다.");
  }

  const cookieStore = await cookies();
  cookieStore.set(
    getStudentCookieName(),
    token,
    getStudentCookieOptions(),
  );

  return token;
}

export async function revokeCurrentStudentSession(
  reason = "student_logout",
): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getStudentCookieName())?.value;

  if (token) {
    const environment = getServerEnvironment();
    const tokenHash = hashStudentSessionToken(
      token,
      environment.STUDENT_SESSION_PEPPER,
    );
    const supabase = getServiceSupabaseClient();

    await supabase
      .from("student_sessions")
      .update({
        revoked_at: new Date().toISOString(),
        revoke_reason: reason,
      })
      .eq("token_hash", tokenHash)
      .is("revoked_at", null);
  }

  cookieStore.delete(getStudentCookieName());
}
