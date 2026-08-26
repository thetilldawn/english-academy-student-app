import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { STUDENT_SESSION_MAX_AGE_SECONDS } from "@/lib/constants";
import { getStudentSessionEnvironment } from "@/lib/env";
import {
  getStudentCookieName,
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
  lastSeenAt: string;
};

type SessionRow = {
  id: string;
  student_id: string;
  code_generation: number;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  students: StudentRow | StudentRow[] | null;
};

type StudentRow = {
  id: string;
  display_name: string;
  school_name: string | null;
  grade_label: string | null;
  status: "active" | "blocked";
  code_generation: number;
  deleted_at: string | null;
};

export async function validateStudentSessionToken(
  token: string,
): Promise<StudentSession | null> {
  const environment = getStudentSessionEnvironment();
  const tokenHash = hashStudentSessionToken(
    token,
    environment.STUDENT_SESSION_PEPPER,
  );
  const supabase = getServiceSupabaseClient();

  const { data: sessionData, error: sessionError } = await supabase
    .from("student_sessions")
    .select(
      "id, student_id, code_generation, expires_at, last_seen_at, revoked_at, students!inner(id, display_name, school_name, grade_label, status, code_generation, deleted_at)",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  const session = sessionData as SessionRow | null;
  const now = Date.now();

  if (
    sessionError ||
    !session ||
    session.revoked_at ||
    Date.parse(session.expires_at) <= now ||
    Date.parse(session.last_seen_at) +
      STUDENT_SESSION_MAX_AGE_SECONDS * 1000 <=
      now
  ) {
    return null;
  }

  const student = Array.isArray(session.students)
    ? session.students[0]
    : session.students;

  if (
    !student ||
    student.deleted_at ||
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
    lastSeenAt: session.last_seen_at,
  };
}

export const getStudentSession = cache(
  async (): Promise<StudentSession | null> => {
    const cookieStore = await cookies();
    const token = cookieStore.get(getStudentCookieName())?.value;

    if (!token) return null;
    return validateStudentSessionToken(token);
  },
);

export async function requireStudentSession(): Promise<StudentSession> {
  const session = await getStudentSession();
  if (!session) redirect("/");
  return session;
}
