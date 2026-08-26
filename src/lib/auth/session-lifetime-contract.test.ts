import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("학생 60일 rolling 세션과 독립 관리자 세션 계약", () => {
  it("학생 세션의 발급과 명시적 갱신을 60일·24시간 임계값으로 맞춘다", () => {
    const constants = source("src/lib/constants.ts");
    const sessionCommand = source(
      "src/lib/auth/student-session-command.ts",
    );
    const sessionQuery = source("src/lib/auth/student-session-query.ts");
    const renewalComponent = source(
      "src/features/session/ui/student-session-renewal.tsx",
    );
    const migration = source(
      "supabase/migrations/20260808180535_add_notification_receipts_and_rolling_sessions.sql",
    );
    const idleTimeoutMigration = source(
      "supabase/migrations/20260809103000_enforce_student_session_idle_timeout.sql",
    );
    const boundedRenewalMigration = source(
      "supabase/migrations/20260826001652_bound_student_session_renewal.sql",
    );

    expect(constants).toContain("STUDENT_SESSION_DAYS = 60");
    expect(constants).toContain("STUDENT_SESSION_RENEWAL_HOURS = 24");
    expect(sessionCommand).toContain('"renew_student_session_v2"');
    expect(sessionCommand).not.toContain("if (row.renewed)");
    expect(sessionCommand).toContain(
      "getStudentCookieOptions(new Date(row.expires_at))",
    );
    expect(sessionQuery).toContain("student.deleted_at");
    expect(sessionQuery).toContain("STUDENT_SESSION_MAX_AGE_SECONDS");
    expect(renewalComponent).toContain("result.nextCheckInMilliseconds");
    expect(migration).toContain("interval '60 days'");
    expect(idleTimeoutMigration).toContain(
      "expires_at > last_seen_at + interval '60 days'",
    );
    expect(idleTimeoutMigration).toContain(
      "session.last_seen_at + interval '60 days' > clock_timestamp()",
    );
    expect(boundedRenewalMigration).toContain("interval '24 hours'");
    expect(boundedRenewalMigration).toContain("interval '60 days'");
    expect(boundedRenewalMigration).toContain("auth.jwt() ->> 'role'");
    expect(boundedRenewalMigration).toContain("notify pgrst, 'reload schema'");
    expect(boundedRenewalMigration).toContain(
      "grant execute on function public.renew_student_session_v2(text)\n  to service_role;",
    );
  });

  it("학생 Proxy는 DB·RPC를 호출하지 않고 실제 권한은 서버 경계에서 확인한다", () => {
    const proxy = source("proxy.ts");

    expect(proxy).not.toContain("refreshStudentSession");
    expect(proxy).not.toContain('"/student/:path*"');
    expect(proxy).not.toContain('"/api/student/:path*"');
    expect(proxy).not.toContain("getServiceSupabaseClient");
    expect(proxy).not.toContain(".rpc(");
  });

  it("Proxy는 관리자 SSR 쿠키 처리 경로만 정확히 제한한다", () => {
    const proxy = source("proxy.ts");

    expect(proxy).toContain("refreshAdminSession(request)");
    expect(proxy).toContain('"/admin/:path*"');
    expect(proxy).toContain('"/api/admin/:path*"');
  });

  it("관리자 쿠키에 학생용 만료시간을 덮어쓰지 않는다", () => {
    const cookieOptions = source("src/lib/supabase/cookie-options.ts");
    const server = source("src/lib/supabase/server.ts");
    const adminProxy = source("src/lib/supabase/proxy.ts");

    expect(cookieOptions).not.toContain("STUDENT_SESSION");
    expect(cookieOptions).not.toContain("maxAge");
    expect(server).toContain("...cookie.options");
    expect(adminProxy).toContain("...cookie.options");
  });
});
