import "server-only";

import {
  LOGIN_MAX_FAILURES_PER_CODE,
  LOGIN_MAX_FAILURES_PER_IP,
  LOGIN_WINDOW_MINUTES,
} from "@/lib/constants";
import { getServerEnvironment } from "@/lib/env";
import {
  hashLoginIp,
  hashStudentCode,
  normalizeStudentCode,
} from "@/lib/auth/student-code";
import { issueStudentSession } from "@/lib/auth/student-session";
import { getClientAddress } from "@/lib/http";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

type LoginGuardResult = {
  rate_limited: boolean;
  authenticated_student_id: string | null;
  authenticated_display_name: string | null;
  authenticated_code_generation: number | null;
};

export type StudentLoginResult =
  | { ok: true; displayName: string }
  | { ok: false; rateLimited: boolean };

export async function authenticateStudentCode(
  request: Request,
  code: string,
): Promise<StudentLoginResult> {
  const environment = getServerEnvironment();
  const normalizedCode = normalizeStudentCode(code);
  const codeHash = hashStudentCode(
    normalizedCode,
    environment.STUDENT_CODE_PEPPER,
  );
  const ipHash = hashLoginIp(
    getClientAddress(request),
    environment.LOGIN_IP_PEPPER,
  );
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "consume_student_login_attempt",
    {
      p_code_lookup_hmac: codeHash,
      p_ip_hash: ipHash,
      p_window_minutes: LOGIN_WINDOW_MINUTES,
      p_max_code_failures: LOGIN_MAX_FAILURES_PER_CODE,
      p_max_ip_failures: LOGIN_MAX_FAILURES_PER_IP,
    },
  );
  if (error) {
    throw new Error("학생 로그인 제한을 확인하지 못했습니다.");
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    | LoginGuardResult
    | null;
  if (result?.rate_limited) {
    return { ok: false, rateLimited: true };
  }
  if (
    !result?.authenticated_student_id ||
    !result.authenticated_display_name ||
    !result.authenticated_code_generation
  ) {
    return { ok: false, rateLimited: false };
  }

  const userAgent = request.headers.get("user-agent");
  await issueStudentSession({
    studentId: result.authenticated_student_id,
    codeGeneration: result.authenticated_code_generation,
    userAgentHash: userAgent
      ? hashLoginIp(`ua:${userAgent}`, environment.LOGIN_IP_PEPPER)
      : null,
  });

  return {
    ok: true,
    displayName: result.authenticated_display_name,
  };
}
