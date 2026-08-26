import "server-only";

import { cookies } from "next/headers";

import { STUDENT_SESSION_MAX_AGE_SECONDS } from "@/lib/constants";
import { getStudentSessionEnvironment } from "@/lib/env";
import {
  generateStudentSessionToken,
  getStudentCookieName,
  getStudentCookieOptions,
  hashStudentSessionToken,
} from "@/lib/auth/student-code";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

type SessionRenewalRow = {
  session_id: string;
  expires_at: string;
  renew_after: string;
  server_now: string;
  renewed: boolean;
};

export type StudentSessionRenewalResult =
  | { status: "invalid" }
  | {
      status: "renewed" | "unchanged";
      expiresAt: string;
      nextCheckInMilliseconds: number;
    };

export async function renewCurrentStudentSession(): Promise<StudentSessionRenewalResult> {
  const cookieStore = await cookies();
  const cookieName = getStudentCookieName();
  const token = cookieStore.get(cookieName)?.value;

  if (!token) return { status: "invalid" };

  const environment = getStudentSessionEnvironment();
  const tokenHash = hashStudentSessionToken(
    token,
    environment.STUDENT_SESSION_PEPPER,
  );
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc("renew_student_session_v2", {
    p_token_hash: tokenHash,
  });
  if (error) throw new Error("학생 세션을 갱신하지 못했습니다.");

  const row = (Array.isArray(data) ? data[0] : data) as
    | SessionRenewalRow
    | null;
  if (
    !row ||
    typeof row.session_id !== "string" ||
    typeof row.expires_at !== "string" ||
    typeof row.renew_after !== "string" ||
    typeof row.server_now !== "string" ||
    typeof row.renewed !== "boolean"
  ) {
    cookieStore.delete(cookieName);
    return { status: "invalid" };
  }

  cookieStore.set(
    cookieName,
    token,
    getStudentCookieOptions(new Date(row.expires_at)),
  );
  return {
    status: row.renewed ? "renewed" : "unchanged",
    expiresAt: row.expires_at,
    nextCheckInMilliseconds: Math.max(
      0,
      Date.parse(row.renew_after) - Date.parse(row.server_now),
    ),
  };
}

export async function issueStudentSession(input: {
  studentId: string;
  codeGeneration: number;
  userAgentHash: string | null;
}): Promise<string> {
  const environment = getStudentSessionEnvironment();
  const token = generateStudentSessionToken();
  const tokenHash = hashStudentSessionToken(
    token,
    environment.STUDENT_SESSION_PEPPER,
  );
  const expiresAt = new Date(
    Date.now() + STUDENT_SESSION_MAX_AGE_SECONDS * 1000,
  );
  const supabase = getServiceSupabaseClient();

  const { error } = await supabase.from("student_sessions").insert({
    student_id: input.studentId,
    token_hash: tokenHash,
    code_generation: input.codeGeneration,
    expires_at: expiresAt.toISOString(),
    user_agent_hash: input.userAgentHash,
  });
  if (error) throw new Error("학생 세션을 발급하지 못했습니다.");

  const cookieStore = await cookies();
  cookieStore.set(
    getStudentCookieName(),
    token,
    getStudentCookieOptions(expiresAt),
  );
  return token;
}

export async function revokeCurrentStudentSession(
  reason = "student_logout",
): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getStudentCookieName())?.value;

  if (token) {
    const environment = getStudentSessionEnvironment();
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
