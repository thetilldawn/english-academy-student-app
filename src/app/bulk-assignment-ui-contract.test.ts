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
    expect(manager).toMatch(/useState<\s*string\[\]\s*>\(\[\]\)/);
    expect(manager).toContain("adminLearningText.page.bulk.selectVisible");
    expect(manager).toContain("<SelectableRow");
    expect(manager).toContain("onToggle={() => toggleBulkStudent(student.id)}");
  });

  it("미리보기와 저장은 controller와 typed adapter 경계만 통과한다", () => {
    const dialog = source(
      "src/features/assignments/ui/bulk-assignment-editor.tsx",
    );
    const controller = source(
      "src/features/assignments/controller/use-bulk-assignment-controller.ts",
    );
    const copy = source("src/content/ko/admin-learning.ts");
    expect(dialog).not.toContain("fetch(");
    expect(dialog).not.toContain('"/api/');
    expect(controller).toContain("buildBulkAssignmentPreviewRequest");
    expect(controller).toContain("buildBulkAssignmentRequest");
    expect(controller).toContain("parseBulkAssignmentPreviewResponse");
    expect(controller).toContain("parseBulkAssignmentCreationResponse");
    expect(controller).toContain("bulkPreviewFingerprint");
    expect(controller).toContain("bulkSubmissionFingerprint");
    expect(copy).toContain(
      "한 학생의 한 회차라도 저장 조건이 맞지 않으면 어떤 시험도 배정하지 않습니다.",
    );
    expect(
      source("src/features/assignments/ui/bulk-series-preview.tsx"),
    ).toContain("adminLearningText.bulkAssignmentModal.atomicHelp");
  });

  it("이전 범위 또는 고정 DAY 수로 날짜별 독립 시험을 미리 본다", () => {
    const fields = source(
      "src/features/assignments/ui/bulk-series-fields.tsx",
    );
    const preview = source(
      "src/features/assignments/ui/bulk-series-preview.tsx",
    );
    const adapter = source(
      "src/features/assignments/api/request-adapters.ts",
    );
    const copy = source("src/content/ko/admin-learning.ts");
    expect(fields).toContain('<option value="previous_span">');
    expect(fields).toContain('<option value="fixed_span">');
    expect(fields).toContain("sessionCount:");
    expect(fields).toContain("unitsPerSession:");
    expect(fields).toContain("actions.changeInterval");
    expect(preview).toContain("item.sessions.map");
    expect(adapter).toContain("firstAvailableFrom");
    expect(adapter).toContain("firstAvailableUntil");
    expect(adapter).toContain("idempotencyKey");
    expect(copy).toContain("회차당 DAY 수 직접 지정");
    expect(copy).not.toContain("다음 7 DAY · 시험 1개");
  });
});
