import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin visual density contract", () => {
  it("does not invent status and score rows when a student has no activity", () => {
    const studentManager = source("src/components/student-manager.tsx");
    const assignmentManager = source("src/components/assignment-manager.tsx");

    expect(studentManager).toContain("adminStudentsText.card.noHistory");
    expect(studentManager).toContain("{priorityActivity ? (");
    expect(studentManager).not.toContain('"시험 기록 없음"');
    expect(assignmentManager).toContain("nextActivity ? (");
    expect(assignmentManager).toContain(
      "<ActivityStatusTimeline item={nextActivity} />",
    );
    expect(assignmentManager).not.toContain('"최근 기록 없음"');
  });

  it("groups student context and learning sources instead of mixing tags", () => {
    const studentManager = source("src/components/student-manager.tsx");

    expect(studentManager).toContain("student-card-profile-tags");
    expect(studentManager).toContain("student-card-primary-source");
    expect(studentManager).toContain("student-card-info-row");
    expect(studentManager).toContain("student-card-source-tags");
    expect(studentManager).toContain("learningSourceTypeLabel");
    expect(studentManager).toContain("supplementalSources");
    expect(studentManager).not.toContain("student-card-next-row");
    expect(studentManager).not.toContain("주 단어장 ·");
  });

  it("keeps one action in summary rows and moves mutations into detail", () => {
    const actions = source("src/components/admin-history-actions.tsx");
    const activities = source(
      "src/components/student-learning-activity-list.tsx",
    );
    const assignmentManager = source("src/components/assignment-manager.tsx");

    expect(actions).toContain("summaryOnly");
    expect(activities).not.toContain("summaryOnly");
    expect(activities).not.toContain("<AdminHistoryActions");
    expect(assignmentManager).not.toContain("<AdminHistoryActions");
  });

  it("filters history by the status people see and compacts overview rows", () => {
    const historyList = source("src/components/admin-history-list.tsx");
    const overview = source("src/components/overview-action-groups.tsx");

    expect(historyList).toContain("learningActivitySection(item)");
    expect(historyList).toContain('value="needs_attention"');
    expect(historyList).toContain('value="retried"');
    expect(historyList).toContain("compact={compact}");
    expect(historyList).toContain("!compact ||");
    expect(historyList).toContain("compact\n            finalScore");
    expect(overview).not.toContain("section.description");
  });

  it("keeps student assignment inside one modal and uses shared sticky footers", () => {
    const studentManager = source("src/components/student-manager.tsx");
    const assignmentManager = source(
      "src/components/assignment-manager.tsx",
    );
    const bulkDialog = source(
      "src/components/bulk-assignment-dialog.tsx",
    );
    const reviewDialog = source(
      "src/components/review-assignment-dialog.tsx",
    );

    expect(studentManager).toContain("embedded");
    expect(studentManager).toContain("assignmentStudentId ? (");
    expect(studentManager).not.toContain("studentDialogSuspendedRef");
    expect(assignmentManager).toContain("<ModalFooter>");
    expect(bulkDialog).toContain("<ModalFooter>");
    expect(reviewDialog).toContain("<ModalFooter>");
  });

  it("loads Pretendard locally and limits serif typography to English words", () => {
    const layout = source("src/app/layout.tsx");
    const css = source("src/app/globals.css");

    expect(layout).toContain(
      'pretendard/dist/web/variable/pretendardvariable.css',
    );
    expect(css.match(/font-family: var\(--font-en\)/g)).toHaveLength(3);
    expect(css).toContain(".choice--en");
    expect(css).toContain(".quiz-prompt");
    expect(css).toContain(".review-entry-list strong");
  });
});
