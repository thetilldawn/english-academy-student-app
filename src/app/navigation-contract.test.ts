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
    expect(loginForm).toContain('"segmented-code-slot"');
    expect(loginForm).toContain("STUDENT_CODE_LENGTH");
    expect(loginForm).toContain("aria-errormessage");
    expect(loginForm).toContain('window.location.replace("/student")');
    expect(loginForm).not.toContain("하이픈은 빼고");
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
    const adminLogin = source("src/components/admin-login-form.tsx");

    expect(adminSession).toContain('redirect("/admin/login")');
    expect(adminLogout).toContain('router.replace("/admin/login")');
    expect(adminLogin).toContain('"로그인 중…" : "관리자 로그인"');
    expect(adminLogin).toContain("requestInFlight.current");
    expect(adminLogin).toContain('window.location.replace("/admin")');
    expect(adminLogin).not.toContain("router.refresh()");
  });

  it("학생 생성 폼은 필수·선택과 현재 단어장을 구분한다", () => {
    const studentManager = source(
      "src/components/student-manager.tsx",
    );
    const adminService = source("src/lib/services/admin-service.ts");

    expect(studentManager).toContain('data-kind="required"');
    expect(studentManager).toContain("필수");
    expect(studentManager.match(/>선택</g)).toHaveLength(4);
    expect(studentManager).toContain('name="currentVocabBook"');
    expect(studentManager).toContain(
      "currentVocabBook: form.get(\"currentVocabBook\")",
    );
    expect(studentManager).toContain(
      'student.currentVocabBook ?? "미입력"',
    );
    expect(adminService).toContain(
      "p_current_vocab_book: input.currentVocabBook",
    );
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
