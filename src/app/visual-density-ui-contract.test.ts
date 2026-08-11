import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin visual density contract", () => {
  it("does not invent status and score rows when a student has no activity", () => {
    const studentDirectory = source(
      "src/features/students/ui/student-directory.tsx",
    );
    const assignmentManager = source("src/components/assignment-manager.tsx");

    expect(studentDirectory).toContain("adminStudentsText.card.noHistory");
    expect(studentDirectory).toContain("{activity ? (");
    expect(studentDirectory).toContain("{hasScore ? (");
    expect(studentDirectory).not.toContain('"시험 기록 없음"');
    expect(assignmentManager).toContain("nextActivity ? (");
    expect(assignmentManager).toContain(
      "<ActivityStatusTimeline item={nextActivity} />",
    );
    expect(assignmentManager).not.toContain('"최근 기록 없음"');
  });

  it("groups student context and learning sources instead of mixing tags", () => {
    const studentDirectory = source(
      "src/features/students/ui/student-directory.tsx",
    );

    expect(studentDirectory).toContain("styles.accountStatuses");
    expect(studentDirectory).toContain("styles.primarySource");
    expect(studentDirectory).toContain("styles.infoRow");
    expect(studentDirectory).toContain("styles.sourceTags");
    expect(studentDirectory).toContain("learningSourceTypeLabel");
    expect(studentDirectory).toContain("supplemental");
    expect(studentDirectory).not.toContain("student-card-next-row");
    expect(studentDirectory).not.toContain("주 단어장 ·");
  });

  it("keeps one action in summary rows and moves mutations into detail", () => {
    const actions = source("src/components/admin-history-actions.tsx");
    const activities = source(
      "src/features/history/ui/student-learning-activity-list.tsx",
    );
    const assignmentManager = source("src/components/assignment-manager.tsx");

    expect(actions).toContain("summaryOnly");
    expect(activities).not.toContain("summaryOnly");
    expect(activities).not.toContain("<AdminHistoryActions");
    expect(assignmentManager).not.toContain("<AdminHistoryActions");
  });

  it("filters history by the status people see and compacts overview rows", () => {
    const historyList = source(
      "src/features/history/ui/admin-history-list.tsx",
    );
    const historyRows = source("src/features/history/ui/history-rows.tsx");
    const historyRow = source(
      "src/features/history/ui/history-activity-row.tsx",
    );
    const overview = source(
      "src/features/history/ui/overview-action-groups.tsx",
    );

    expect(historyList).toContain("learningActivitySection(item)");
    expect(historyList).toContain('value="needs_attention"');
    expect(historyList).toContain('value="retried"');
    expect(historyRows).toContain('showScore={compact ? "meaningful" : "always"}');
    expect(historyRow).toContain('showScore = "always"');
    expect(overview).toContain("<HistoryRows compact items={section.items} />");
    expect(overview).not.toContain("section.description");
  });

  it("keeps student assignment inside one modal and uses shared sticky footers", () => {
    const studentDetail = source(
      "src/features/students/ui/student-detail-dialog.tsx",
    );
    const studentAssignment = source(
      "src/features/students/ui/panels/student-assignment-panel.tsx",
    );
    const assignmentManager = source(
      "src/components/assignment-manager.tsx",
    );
    const singleEditor = source(
      "src/features/assignments/ui/single-assignment-editor.tsx",
    );
    const bulkDialog = source(
      "src/features/assignments/ui/bulk-assignment-editor.tsx",
    );
    const reviewDialog = source(
      "src/features/assignments/ui/legacy-review-recovery.tsx",
    );

    expect(studentDetail).toContain("<StudentAssignmentPanel");
    expect(studentAssignment).toContain("<SingleAssignmentEditor");
    expect(studentAssignment).toContain("embedded");
    expect(studentAssignment).not.toContain("AssignmentManager");
    expect(studentAssignment).not.toContain("launcherOnly");
    expect(assignmentManager).toContain("<SingleAssignmentEditor");
    expect(singleEditor).toContain("<DialogFooter");
    expect(bulkDialog).toContain("<DialogFooter>");
    expect(reviewDialog).toContain("<DialogFooter>");
  });

  it("loads Pretendard locally and limits serif typography to English words", () => {
    const layout = source("src/app/layout.tsx");
    const css = source("src/app/globals.css");
    const quizCss = source(
      "src/features/quiz-player/ui/quiz-frame.module.css",
    );

    expect(layout).toContain(
      'pretendard/dist/web/variable/pretendardvariable.css',
    );
    expect(css.match(/font-family: var\(--font-en\)/g)).toHaveLength(2);
    expect(css).toContain(".choice--en");
    expect(quizCss).toMatch(
      /\.promptEnglish\s*\{[\s\S]*?font-family:\s*var\(--font-en\);/,
    );
    expect(css).toContain(".review-entry-list strong");
  });
});
