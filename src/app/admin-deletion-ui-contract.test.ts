import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin deletion UI contract", () => {
  it("오버뷰·학생 관리·시험 관리에서 같은 안전한 작업을 제공한다", () => {
    const historyActions = source(
      "src/components/admin-history-actions.tsx",
    );
    const historyList = source(
      "src/components/admin-history-list.tsx",
    );
    const detailActions = source(
      "src/components/history-detail-actions.tsx",
    );
    const studentManager = source(
      "src/components/student-manager.tsx",
    );
    const assignmentPage = source(
      "src/app/admin/(protected)/assignments/page.tsx",
    );
    const learningActivityList = source(
      "src/components/student-learning-activity-list.tsx",
    );
    const historyCopy = source("src/content/ko/admin-history.ts");
    const studentCopy = source("src/content/ko/admin-students.ts");

    expect(historyList).toContain("historyDetailHref(item)");
    expect(detailActions).toContain("<AdminHistoryActions");
    expect(historyActions).toContain("adminHistoryText.actions.cancel.action");
    expect(historyCopy).toContain('action: "배정 취소"');
    expect(historyActions).not.toContain("시험 전체 삭제");
    expect(historyActions).toContain("adminHistoryText.actions.delete.action");
    expect(historyCopy).toContain('action: "내역 삭제"');
    expect(studentManager).toContain("adminStudentsText.account.delete");
    expect(studentCopy).toContain('delete: "학생 삭제"');
    expect(learningActivityList).toContain("<AdminHistoryActions");
    expect(assignmentPage).not.toContain("listAssignments()");
    expect(assignmentPage).not.toContain("<AssignmentManagementList");
  });

  it("삭제된 학생·시험은 목록에서 빠지고 과거 내역은 삭제됨으로 남는다", () => {
    const adminService = source("src/lib/services/admin-service.ts");
    const quizService = source("src/lib/services/quiz-service.ts");
    const detailActions = source(
      "src/components/history-detail-actions.tsx",
    );

    expect(adminService).toContain('.is("deleted_at", null)');
    expect(adminService).toContain('"삭제됨"');
    expect(adminService).toContain("admin_history_hidden_entries");
    expect(adminService).toContain("HISTORY_PAGE_SIZE");
    expect(adminService).toContain(
      ".range(from, from + HISTORY_PAGE_SIZE - 1)",
    );
    expect(quizService).toContain('.is("deleted_at", null)');
    expect(detailActions).toContain("!item.studentDeleted");
    expect(detailActions).toContain("refreshAfterMutation={false}");
    expect(detailActions).toContain('window.addEventListener("popstate"');
    expect(detailActions).toContain(
      "window.requestAnimationFrame(() => router.refresh())",
    );
    expect(detailActions).toContain(
      'window.location.replace("/admin/results")',
    );
    expect(detailActions).not.toContain("window.setTimeout");
  });

  it("태블릿·PC 상태 문구와 배정 버튼 글자색을 보존한다", () => {
    const css = source("src/app/globals.css");

    expect(css).toMatch(
      /\.status-pill\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(css).toMatch(
      /\.deadline-countdown\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(css).not.toContain(
      ".assignment-student-row span:not(.button)",
    );
    expect(css).toMatch(
      /\.status-badge\s*\{[\s\S]*?color:\s*var\(--status-fg\);[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(css).toContain(
      ".student-management-summary span:not(.status-pill)",
    );
    expect(css).not.toContain(
      ".assignment-student-row span {\n  color:",
    );
  });
});
