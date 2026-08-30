import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("student management feature boundary", () => {
  const directory = source("src/features/students/ui/student-directory.tsx");
  const directoryCard = source("src/features/students/ui/student-directory-card.tsx");
  const directoryCss = source("src/features/students/ui/student-directory.module.css");
  const detailDialog = source("src/features/students/ui/student-detail-dialog.tsx");
  const detailPage = source("src/features/students/ui/student-detail-page.tsx");
  const detailContent = source("src/features/students/ui/student-detail-content.tsx");
  const detailRouteGuard = source("src/components/use-route-exit-guard.ts");
  const guardedLink = source("src/components/guarded-link.tsx");
  const adminLayout = source("src/app/admin/(protected)/layout.tsx");
  const info = source("src/features/students/ui/panels/student-info-panel.tsx");
  const account = source("src/features/students/ui/panels/student-account-panel.tsx");
  const wrongCss = source("src/features/students/ui/panels/student-wrong-word-panel.module.css");
  const globalCss = source("src/app/globals.css");

  it("shares one detail body while keeping profile and access actions separate", () => {
    expect(detailDialog).toContain("<RoutedDetailDialog");
    expect(detailDialog).toContain("<StudentDetailContent");
    expect(detailContent).toContain("<StudentInfoPanel");
    expect(detailContent).toContain("<StudentAccountPanel");
    expect(detailContent).toContain("<StudentHistoryPanel");
    expect(detailContent).toContain('dynamic(');
    expect(detailContent).toContain('import("./panels/student-history-panel")');
    expect(detailContent).not.toContain(
      'import { StudentHistoryPanel } from "./panels/student-history-panel"',
    );
    expect(detailContent).toContain('id="student-history-panel"');
    expect(detailContent).toContain('aria-labelledby="student-history-tab"');
    expect(detailContent).not.toMatch(/StudentAssignmentPanel|StudentLearningPanel/);
    expect(info).toContain("controller.actions.save()");
    expect(account).toContain("controller.actions.revealCode()");
    expect(account).toContain("controller.actions.rotateCode()");
    expect(account).toContain("controller.actions.block()");
    expect(account).toContain("controller.actions.remove()");
    expect(account).not.toContain("controller.actions.save()");
    expect(detailDialog).toContain("useRouteExitGuard({");
    expect(detailPage).toContain("<GuardedLink");
    expect(detailPage).toContain('href="/admin/students"');
    expect(detailPage).not.toContain('router.push("/admin/students")');
    expect(detailRouteGuard).toContain(
      "useUnsavedChangesWarning(active, activeRef)",
    );
    expect(detailRouteGuard).toContain('window.addEventListener("popstate"');
    expect(detailRouteGuard).toContain('document.addEventListener("click"');
    expect(detailRouteGuard).toContain("if (!link?.hashOnly) return");
    expect(guardedLink).toContain("onNavigate={(event) =>");
    expect(guardedLink).toContain("requestNavigation(() =>");
    expect(adminLayout).toContain("<NavigationExitGuardProvider>");
    expect(detailContent).toContain("announceStudentDirectoryRefresh()");
  });

  it("renders only the server directory summary and does not prefetch private details", () => {
    expect(directory).toContain("<StudentDirectoryList");
    expect(directoryCard).toContain("student.completedCount");
    expect(directoryCard).toContain("student.missedCount");
    expect(directoryCard).toContain("student.notStartedCount");
    expect(directoryCard).toContain("student.rawPoints");
    expect(directoryCard).toContain("prefetch={false}");
    expect(directoryCard).not.toContain("AttemptScoreSummary");
    expect(directoryCard).not.toContain("ActivityStatusTimeline");
  });

  it("uses direct Server queries and one shared direct/intercepted detail route component", () => {
    const page = source("src/app/admin/(protected)/students/page.tsx");
    const directoryContent = source("src/features/students/server/components/student-directory-content.tsx");
    const detailRouteContent = source("src/features/students/server/components/student-detail-route-content.tsx");
    const detailQuery = source("src/features/students/server/queries/student-detail-query.ts");
    const directoryQuery = source("src/features/students/server/queries/student-directory-query.ts");
    const historyQuery = source("src/features/students/server/queries/student-history-query.ts");
    const directoryRoute = source("src/app/api/admin/students/directory/route.ts");
    const historyRoute = source("src/app/api/admin/students/[id]/history/route.ts");
    const directPage = source("src/app/admin/(protected)/students/[studentId]/page.tsx");
    const interceptedPage = source("src/app/admin/(protected)/@detail/(.)students/[studentId]/page.tsx");

    expect(page).toContain("<StudentDirectoryContent />");
    expect(page).toContain("<StudentCreateContent />");
    expect(page).toContain("<Suspense");
    expect(directoryContent).toContain("getStudentDirectoryInitial(");
    expect(directoryContent).not.toContain("fetch(");
    expect(detailRouteContent).toContain("getStudentDetailInitial(parsedId.data)");
    expect(detailRouteContent).toContain("notFound()");
    expect(detailRouteContent).not.toContain("fetch(");
    expect(detailQuery).toContain("await requireAdmin()");
    expect(detailQuery).toContain('"get_admin_student_detail_initial_v2"');
    expect(directoryQuery).toContain("if (!authenticatedAdmin) await requireAdmin()");
    expect(historyQuery).toContain("if (!authenticatedAdmin) await requireAdmin()");
    expect(directoryRoute).toContain("getStudentDirectoryInitial(parsed.data, admin)");
    expect(directoryRoute).toContain("privateJsonError");
    expect(directoryRoute).not.toMatch(/\bjsonError\(/);
    expect(directoryRoute).toContain('"Cache-Control": "private, no-store"');
    expect(historyRoute).toMatch(/getStudentHistoryInitial\(\{[\s\S]*?\}, admin\)/);
    expect(historyRoute).toContain("privateJsonError");
    expect(historyRoute).not.toMatch(/\bjsonError\(/);
    expect(historyRoute).toContain('"Cache-Control": "private, no-store"');
    expect(directPage).toContain("await params");
    expect(interceptedPage).toContain("await params");
    expect(directPage).toContain("<StudentDetailRouteContent");
    expect(interceptedPage).toContain("<StudentDetailRouteContent");
  });

  it("keeps long names and wrong-word rows inside 320 through 1440 pixels", () => {
    expect(directoryCss).toMatch(/\.card\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/);
    expect(directoryCss).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.card\s*\{[^}]*grid-template-columns:\s*1fr;/);
    expect(directoryCss).toMatch(/@media \(max-width: 359px\)[\s\S]*?\.primarySource\s*\{[^}]*overflow-wrap:\s*anywhere;/);
    expect(wrongCss).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.row\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/);
    expect(wrongCss).toMatch(/@media \(max-width: 359px\)[\s\S]*?\.row\s*\{[^}]*grid-template-columns:\s*1fr;/);
  });

  it("keeps retired student selectors out of the global cascade", () => {
    expect(globalCss).not.toMatch(/\.(?:student-card|student-dialog-|student-learning-|student-code-|wrong-word-)/);
  });
});
