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
    const studentCopy = source("src/content/ko/student-app.ts");

    expect(homePage).toContain("<StudentLoginForm />");
    expect(homePage).toContain('redirect("/student")');
    expect(homePage).toContain('href="/admin/login"');
    expect(homePage).not.toContain('href="/code"');
    expect(loginForm).toContain("studentAppText.login.submitting");
    expect(loginForm).toContain("studentAppText.login.submit");
    expect(studentCopy).toContain('submitting: "인증 중…"');
    expect(studentCopy).toContain('submit: "인증"');
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

  it("학생·관리자 세션을 같은 브라우저에서 독립적으로 유지한다", () => {
    const studentSessionRoute = source(
      "src/app/api/student/session/route.ts",
    );
    const studentLayout = source(
      "src/app/student/(protected)/layout.tsx",
    );
    const adminSessionRoute = source(
      "src/app/api/admin/session/route.ts",
    );
    const adminLayout = source(
      "src/app/admin/(protected)/layout.tsx",
    );

    expect(studentSessionRoute).not.toContain("auth.signOut()");
    expect(adminSessionRoute).not.toContain(
      "revokeCurrentStudentSession",
    );
    expect(studentLayout).toContain(
      "const student = await getStudentSession()",
    );
    expect(studentLayout).not.toContain("getAdminContext()");
    expect(adminLayout).toContain("requireAdmin()");
    expect(adminLayout).not.toContain("getStudentSession()");
  });

  it("관리자 로그인은 독립 경로를 유지한다", () => {
    const adminSession = source("src/lib/auth/admin.ts");
    const adminLogout = source("src/components/admin-logout-button.tsx");
    const adminLogin = source("src/components/admin-login-form.tsx");
    const adminCopy = source("src/content/ko/admin-shell.ts");

    expect(adminSession).toContain('redirect("/admin/login")');
    expect(adminLogout).toContain('router.replace("/admin/login")');
    expect(adminLogin).toContain("adminShellText.login.submitting");
    expect(adminLogin).toContain("adminShellText.login.submit");
    expect(adminCopy).toContain('submitting: "로그인 중…"');
    expect(adminCopy).toContain('submit: "관리자 로그인"');
    expect(adminLogin).toContain("requestInFlight.current");
    expect(adminLogin).toContain('window.location.replace("/admin")');
    expect(adminLogin).not.toContain("router.refresh()");
  });

  it("학생 생성 폼은 단어장을 선택 사항으로 둔다", () => {
    const studentManager = source(
      "src/components/student-manager.tsx",
    );
    const studentCopy = source("src/content/ko/admin-students.ts");
    const adminService = source("src/lib/services/admin-service.ts");

    expect(studentManager).toContain('data-kind="required"');
    expect(studentManager).toContain(
      "adminStudentsText.createStudent.required",
    );
    expect(studentCopy).toContain('required: "필수"');
    expect(studentManager).toContain('name="currentVocabDatasetId"');
    expect(studentManager).toContain(
      'currentVocabDatasetId: form.get("currentVocabDatasetId")',
    );
    expect(studentManager).toContain("datasets.map");
    expect(studentManager).toContain(
      "adminStudentsText.createStudent.chooseLater",
    );
    expect(studentManager).toContain(
      "adminStudentsText.createStudent.noWordbookNotice",
    );
    expect(studentManager).not.toContain(
      'disabled={busyKey !== "" || datasets.length === 0}',
    );
    expect(studentManager).not.toContain('name="currentVocabBook"');
    expect(studentManager).toContain("student.currentVocabBook,");
    expect(studentManager).toContain("adminStudentsText.card.wordbookMissing");
    expect(adminService).toContain(
      "p_current_vocab_dataset_id: input.currentVocabDatasetId",
    );
    expect(adminService).toContain('"create_student_with_code_v2"');
  });

  it("관리자 세 화면폭 메뉴와 시험 집중 셸을 유지한다", () => {
    const adminLayout = source("src/app/admin/(protected)/layout.tsx");
    const adminLoading = source(
      "src/app/admin/(protected)/loading.tsx",
    );
    const adminPageTitle = source("src/components/admin-page-title.tsx");
    const adminCopy = source("src/content/ko/admin-shell.ts");
    const studentShell = source("src/components/student-shell.tsx");

    expect(adminLayout).toContain('variant="sidebar"');
    expect(adminLayout).toContain('variant="tablet"');
    expect(adminLayout).toContain('variant="mobile"');
    expect(source("src/components/admin-navigation.tsx")).toContain(
      "ADMIN_ROUTES.map",
    );
    expect(adminLayout.match(/\{admin\.displayName\}/g)).toHaveLength(2);
    expect(adminLayout).not.toContain("admin-mobile-user-label");
    expect(adminLayout).not.toContain(">관리자<");
    expect(adminPageTitle).toContain("adminRouteForSegment(segment).pageTitle");
    expect(adminCopy).toContain('learning: "학습 관리"');
    expect(adminPageTitle).not.toContain('title: "시험 관리"');
    expect(adminLayout).not.toContain(
      'export const dynamic = "force-dynamic"',
    );
    expect(adminLoading).toContain('className="admin-route-loading"');
    expect(studentShell).toContain(
      'pathname.startsWith("/student/attempt/")',
    );
    expect(studentShell).toContain("!focusedAttempt");
  });

  it("관리자 테마 스위치는 상태에 맞는 접근성 이름만 표시한다", () => {
    const themeToggle = source("src/components/theme-toggle.tsx");
    const adminCopy = source("src/content/ko/admin-shell.ts");

    expect(themeToggle).toContain("adminShellText.theme.toLight");
    expect(themeToggle).toContain("adminShellText.theme.toDark");
    expect(themeToggle).toContain("aria-label={adminShellText.theme.ariaLabel}");
    expect(adminCopy).toContain('toLight: "라이트 모드로 전환"');
    expect(adminCopy).toContain('toDark: "다크 모드로 전환"');
    expect(adminCopy).toContain('ariaLabel: "화면 테마"');
    expect(themeToggle).toContain("title={actionLabel}");
    expect(themeToggle).not.toContain("theme-toggle-label");
    expect(themeToggle).not.toContain(">다크<");
  });

  it("관리 화면은 목록에서 모달로 이어지고 중복 작업판을 두지 않는다", () => {
    const studentManager = source(
      "src/components/student-manager.tsx",
    );
    const assignmentManager = source(
      "src/components/assignment-manager.tsx",
    );
    const studentCopy = source("src/content/ko/admin-students.ts");
    const learningCopy = source("src/content/ko/admin-learning.ts");

    expect(studentManager).toContain('variant="dialog"');
    expect(studentManager).toContain("adminStudentsText.detailTabs.history");
    expect(studentManager).toContain("adminStudentsText.detailTabs.account");
    expect(studentCopy).toContain('history: "내역"');
    expect(studentCopy).toContain('account: "계정 설정"');
    expect(studentManager).not.toContain("student-action-pane");
    expect(studentManager).not.toContain(
      'className="student-actions-disclosure"',
    );
    expect(assignmentManager).toContain("<Tabs");
    expect(assignmentManager).toContain(
      "ariaLabel={adminLearningText.page.tabsAria}",
    );
    expect(assignmentManager).toContain(
      "adminLearningText.page.vocabularyTab",
    );
    expect(assignmentManager).toContain(
      "adminLearningText.page.otherLearningTab",
    );
    expect(learningCopy).toContain('otherLearningTab: "다른 학습"');
    expect(assignmentManager).toContain('type="search"');
    expect(assignmentManager).toContain('size="extra-wide"');
    expect(studentManager).toContain(
      "adminStudentsText.learning.nextVocabularyTitle",
    );
    expect(studentManager).toContain("student-inline-assignment-action");
    expect(studentManager).toContain("launcherOnly");
  });

  it("오버뷰와 내역은 미응시를 포함한 공통 이력을 사용한다", () => {
    const overview = source("src/app/admin/(protected)/page.tsx");
    const results = source(
      "src/app/admin/(protected)/results/page.tsx",
    );
    const historyList = source(
      "src/components/admin-history-list.tsx",
    );
    const overviewGroups = source(
      "src/components/overview-action-groups.tsx",
    );
    const historyCopy = source("src/content/ko/admin-history.ts");
    const overviewCopy = source("src/content/ko/admin-overview.ts");
    const interceptedDetail = source(
      "src/app/admin/(protected)/@detail/(.)results/[entryKey]/page.tsx",
    );
    const scorePresentation = source(
      "src/lib/ui/attempt-score-presentation.ts",
    );

    expect(overview).toContain("listAssignmentHistory");
    expect(overview).not.toContain("listAttempts");
    expect(overview).not.toContain("listAssignments");
    expect(results).toContain("listAssignmentHistory");
    expect(historyList).toContain("adminHistoryText.filters.statusOptions");
    expect(historyCopy).toContain('completed: "첫 시험 완료"');
    expect(scorePresentation).toContain('label: "최종"');
    expect(scorePresentation).toContain('label: "재시험"');
    expect(historyCopy).toContain('needsAttention: "미통과·미응시"');
    expect(historyList).toContain("historyDetailHref(item)");
    expect(historyList).toContain("<ActivityStatusTimeline");
    expect(interceptedDetail).toContain("getAdminHistoryDetail(entryKey)");
    expect(overview).toContain("<OverviewActionGroups");
    expect(overviewGroups).toContain("<AdminHistoryList compact items={section.items} />");
    expect(overviewGroups).not.toContain("onSelectStudent");
    expect(overviewGroups).not.toContain("StudentManager");
    expect(overviewGroups).not.toContain("slice(0, 8)");
    expect(overviewGroups).toContain("adminOverviewText.countSuffix");
    expect(overviewCopy).toContain('countSuffix: "건"');
    expect(interceptedDetail).toContain("<RouteDetailDialog");
  });

  it("첫 시험 뒤 결과를 먼저 보여주고 학생이 재시험을 시작한다", () => {
    const quizPlayer = source("src/components/quiz-player.tsx");
    const resultPage = source(
      "src/app/student/(protected)/result/[id]/page.tsx",
    );
    const retryButton = source(
      "src/components/start-retry-button.tsx",
    );
    const retryRoute = source(
      "src/app/api/student/attempts/[id]/retry/route.ts",
    );
    const studentHome = source(
      "src/app/student/(protected)/page.tsx",
    );
    const studentCopy = source("src/content/ko/student-app.ts");

    expect(quizPlayer).toContain(
      'payload.needsRetry && answeredPhase === "initial"',
    );
    expect(resultPage).toContain(
      'result.status === "in_progress" && result.phase === "review"',
    );
    expect(resultPage).toContain("<StartRetryButton");
    expect(retryButton).toContain("studentAppText.actions.retryPending");
    expect(retryButton).toContain("studentAppText.actions.retry");
    expect(retryRoute).toContain("isSameOriginRequest(request)");
    expect(retryRoute).toContain("startStudentRetry");
    expect(studentHome).toContain('assignment.lastPhase === "review"');
    expect(studentHome).toContain("studentAppText.dashboard.resultAndRetry");
    expect(studentCopy).toContain('resultAndRetry: "결과 확인·재시험 선택"');
    expect(studentHome).toContain(
      "href={`/student/result/${assignment.lastAttemptId}`}",
    );
  });
});
