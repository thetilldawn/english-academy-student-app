import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("responsive navigation contract", () => {
  it("학생 인증을 첫 화면에 두고 기존 /code 주소는 첫 화면으로 보낸다", () => {
    const homePage = source("src/app/page.tsx");
    const codePage = source("src/app/code/page.tsx");
    const loginForm = source("src/components/student-login-form.tsx");

    expect(homePage).toContain("<StudentLoginForm />");
    expect(homePage).toContain('href="/admin/login"');
    expect(homePage).not.toContain('href="/code"');
    expect(loginForm).toContain('"인증 중…" : "인증"');
    expect(codePage).toContain('redirect("/")');
  });

  it("학생 무세션과 접속 종료는 첫 화면으로 돌아간다", () => {
    const studentSession = source("src/lib/auth/student-session.ts");
    const studentLogout = source(
      "src/components/student-logout-button.tsx",
    );

    expect(studentSession).toContain('redirect("/")');
    expect(studentSession).not.toContain('redirect("/code")');
    expect(studentLogout).toContain('router.replace("/")');
  });

  it("관리자 로그인은 독립 경로를 유지한다", () => {
    const adminSession = source("src/lib/auth/admin.ts");
    const adminLogout = source("src/components/admin-logout-button.tsx");

    expect(adminSession).toContain('redirect("/admin/login")');
    expect(adminLogout).toContain('router.replace("/admin/login")');
  });

  it("관리자 세 화면폭 메뉴와 시험 집중 셸을 유지한다", () => {
    const adminLayout = source("src/app/admin/(protected)/layout.tsx");
    const studentShell = source("src/components/student-shell.tsx");

    expect(adminLayout).toContain('className="admin-sidebar-nav"');
    expect(adminLayout).toContain('className="admin-tablet-nav"');
    expect(adminLayout).toContain('className="admin-mobile-nav"');
    expect(studentShell).toContain(
      'pathname.startsWith("/student/attempt/")',
    );
    expect(studentShell).toContain("!focusedAttempt");
  });
});
