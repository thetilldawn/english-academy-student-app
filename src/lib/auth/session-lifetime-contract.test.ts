import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("학생 60일 rolling 세션과 독립 관리자 세션 계약", () => {
  it("학생 세션의 발급과 정상 접속 갱신을 모두 60일로 맞춘다", () => {
    const constants = source("src/lib/constants.ts");
    const studentProxy = source("src/lib/auth/student-session-proxy.ts");
    const migration = source(
      "supabase/migrations/20260808180535_add_notification_receipts_and_rolling_sessions.sql",
    );

    expect(constants).toContain("STUDENT_SESSION_DAYS = 60");
    expect(studentProxy).toContain('"refresh_student_session_v1"');
    expect(studentProxy).toContain("getStudentCookieOptions()");
    expect(studentProxy).toContain("if (error) {");
    expect(studentProxy).toMatch(/if \(error\) \{\s+return response;/);
    expect(studentProxy).toMatch(/if \(!refreshed\) \{\s+response\.cookies\.delete/);
    expect(migration).toContain("interval '60 days'");
  });

  it("학생 로그인·로그아웃 API에서는 proxy 갱신을 건너뛴다", () => {
    const studentProxy = source("src/lib/auth/student-session-proxy.ts");

    expect(studentProxy).toContain(
      'request.nextUrl.pathname === "/api/student/session"',
    );
  });

  it("proxy가 관리자와 학생 경로를 분리해 갱신한다", () => {
    const proxy = source("proxy.ts");

    expect(proxy).toContain("refreshAdminSession(request)");
    expect(proxy).toContain("refreshStudentSession(request)");
    expect(proxy).toContain('"/student/:path*"');
    expect(proxy).toContain('"/api/student/:path*"');
  });

  it("관리자 쿠키에 학생용 180일 제한을 덮어쓰지 않는다", () => {
    const cookieOptions = source("src/lib/supabase/cookie-options.ts");
    const server = source("src/lib/supabase/server.ts");
    const adminProxy = source("src/lib/supabase/proxy.ts");

    expect(cookieOptions).not.toContain("STUDENT_SESSION");
    expect(cookieOptions).not.toContain("maxAge");
    expect(server).toContain("...cookie.options");
    expect(adminProxy).toContain("...cookie.options");
  });
});
