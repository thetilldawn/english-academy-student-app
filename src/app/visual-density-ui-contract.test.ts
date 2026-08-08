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

    expect(studentManager).toContain('"학습 기록 없음"');
    expect(studentManager).toContain("{priorityActivity ? (");
    expect(studentManager).not.toContain('"시험 기록 없음"');
    expect(assignmentManager).toContain("{nextActivity ? (");
    expect(assignmentManager).not.toContain('"최근 기록 없음"');
  });

  it("groups student context and learning sources instead of mixing tags", () => {
    const studentManager = source("src/components/student-manager.tsx");

    expect(studentManager).toContain("student-card-profile-tags");
    expect(studentManager).toContain("student-card-source-tags");
    expect(studentManager).toContain("student-card-next-row");
    expect(studentManager).toContain("learningSourceTypeLabel");
    expect(studentManager).toContain("sourceTags.slice(0, 2)");
  });

  it("keeps one action in summary rows and moves mutations into detail", () => {
    const actions = source("src/components/admin-history-actions.tsx");
    const activities = source(
      "src/components/student-learning-activity-list.tsx",
    );
    const assignmentManager = source("src/components/assignment-manager.tsx");

    expect(actions).toContain("summaryOnly");
    expect(activities).toContain("summaryOnly");
    expect(assignmentManager).not.toContain("<AdminHistoryActions");
  });

  it("filters history by the status people see and compacts overview rows", () => {
    const historyList = source("src/components/admin-history-list.tsx");
    const overview = source("src/components/overview-action-groups.tsx");

    expect(historyList).toContain("historyStatusFilterValue");
    expect(historyList).toContain('value="needs_attention"');
    expect(historyList).toContain('value="retried"');
    expect(historyList).toContain("compact={compact}");
    expect(historyList).toContain("{!compact ? (");
    expect(overview).not.toContain("section.description");
  });
});
