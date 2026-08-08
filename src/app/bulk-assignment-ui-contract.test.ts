import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("학습 관리 일괄 배정 UI 계약", () => {
  it("학생은 기본 0명이고 현재 필터 목록을 명시적으로 선택한다", () => {
    const manager = source("src/components/assignment-manager.tsx");
    expect(manager).toContain(
      "const [selectedBulkStudentIds, setSelectedBulkStudentIds]",
    );
    expect(manager).toContain("useState<\n    string[]\n  >([])");
    expect(manager).toContain("adminLearningText.page.bulk.selectVisible");
    expect(manager).toContain("type=\"checkbox\"");
  });

  it("미리보기와 저장은 일괄 배정 전용 API만 호출한다", () => {
    const dialog = source("src/components/bulk-assignment-dialog.tsx");
    const copy = source("src/content/ko/admin-learning.ts");
    expect(dialog).toContain(
      'fetch("/api/admin/bulk-assignments/preview"',
    );
    expect(dialog).toContain('fetch("/api/admin/bulk-assignments"');
    expect(copy).toContain(
      "한 학생이라도 저장 조건이 맞지 않으면 아무 학생에게도 배정하지 않습니다.",
    );
    expect(dialog).toContain("adminLearningText.bulkAssignmentModal.atomicHelp");
    expect(dialog).toContain("<HelpTip");
  });
});
