import { type NextRequest, NextResponse } from "next/server";

import { getStudentSessionEnvironment } from "@/lib/env";
import {
  getStudentCookieName,
  getStudentCookieOptions,
  hashStudentSessionToken,
} from "@/lib/auth/student-code";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

export async function refreshStudentSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const cookieName = getStudentCookieName();
  const token = request.cookies.get(cookieName)?.value;

  if (!token || request.nextUrl.pathname === "/api/student/session") {
    return response;
  }

  try {
    const environment = getStudentSessionEnvironment();
    const tokenHash = hashStudentSessionToken(
      token,
      environment.STUDENT_SESSION_PEPPER,
    );
    const supabase = getServiceSupabaseClient();
    const { data, error } = await supabase.rpc(
      "refresh_student_session_v1",
      { p_token_hash: tokenHash },
    );
    const refreshed = Array.isArray(data) ? data[0] : data;

    if (error) {
      return response;
    }

    if (!refreshed) {
      response.cookies.delete(cookieName);
      return response;
    }

    response.cookies.set(
      cookieName,
      token,
      getStudentCookieOptions(),
    );
    return response;
  } catch {
    return response;
  }
}
