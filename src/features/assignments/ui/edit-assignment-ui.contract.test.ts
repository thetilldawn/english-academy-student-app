import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("배정과 수정 화면 공통 계약", () => {
  it("신규 배정과 수정이 같은 개별 범위 선택 부품을 쓴다", () => {
    const createRange = source(
      "src/features/assignments/ui/vocab-range-fields.tsx",
    );
    const editRange = source(
      "src/features/assignments/ui/assignment-range-fields.tsx",
    );

    expect(createRange).toContain("<AssignmentUnitRangePicker");
    expect(editRange).toContain("<AssignmentUnitRangePicker");
    expect(editRange).not.toContain("selectInclusiveUnitRange");
    expect(editRange).not.toContain("selectStart");
    expect(editRange).not.toContain("selectEnd");
  });

  it("수정 조건도 단어 수부터 공통 시험 조건 순서로 배치한다", () => {
    const settings = source(
      "src/features/assignments/ui/assignment-settings-fields.tsx",
    );
    const count = settings.indexOf("<AssignmentWordCountField");
    const order = settings.indexOf("<ExamQuestionOrderField");
    const exam = settings.indexOf("<ExamConditionFields");

    expect(count).toBeGreaterThan(-1);
    expect(order).toBeGreaterThan(count);
    expect(exam).toBeGreaterThan(order);
    expect(settings).not.toContain("optionalTitle");
  });

  it("수정도 시험 종류와 네 단계 제목을 같은 순서로 표시한다", () => {
    const editor = source(
      "src/features/assignments/ui/single-assignment-editor-sections.tsx",
    );
    const range = editor.indexOf('title="시험 범위"');
    const conditions = editor.indexOf('title="시험 조건"');
    const schedule = editor.indexOf('title="시험 일정"');
    const preview = editor.indexOf('title="미리보기"');

    expect(editor).toContain('ariaLabel="시험 종류"');
    expect(
      source("src/features/assignments/ui/assignment-editor-shell.tsx"),
    ).toContain("aria-label={ariaLabel}");
    expect(editor).toContain("단어 시험");
    expect(editor).toContain("오답 시험");
    expect(range).toBeGreaterThan(-1);
    expect(conditions).toBeGreaterThan(range);
    expect(schedule).toBeGreaterThan(conditions);
    expect(preview).toBeGreaterThan(schedule);
  });

  it("수정 헤더에 학생과 학교를 표시하고 시험 종류를 전달한다", () => {
    for (const file of [
      "src/features/history/ui/editable-history-detail-dialog.tsx",
      "src/features/history/ui/editable-history-detail-page.tsx",
    ]) {
      const value = source(file);
      expect(value).toContain("detail.summary.schoolName");
      expect(value).toContain(
        "purpose: editor.editorModel.initialEditDraft.purpose",
      );
    }
  });

  it("기존 오답 포함 시험의 내용을 잠그고 옛 혼합 UI를 제거한다", () => {
    const sections = source(
      "src/features/assignments/ui/single-assignment-editor-sections.tsx",
    );
    const settings = source(
      "src/features/assignments/ui/assignment-settings-fields.tsx",
    );
    const props = source(
      "src/features/assignments/ui/single-assignment-editor.types.ts",
    );

    expect(sections).toContain('editPurpose === "mixed"');
    expect(sections).toContain("lockedMixed");
    expect(settings).toContain("fieldPolicy.questionCount");
    expect(settings).toContain("fieldPolicy.direction");
    expect(props).not.toContain("availableReviewLevel");
    expect(
      fs.existsSync(
        path.resolve(
          "src/features/assignments/ui/assignment-review-fields.tsx",
        ),
      ),
    ).toBe(false);
  });

  it("uses the settled assigned-test label in both locked schedule fields", () => {
    const availability = source(
      "src/features/assignments/ui/assignment-availability-fields.tsx",
    );
    const deadline = source(
      "src/features/assignments/ui/assignment-deadline-fields.tsx",
    );

    for (const value of [availability, deadline]) {
      expect(value).toContain('toggleLockedText="배정된 시험 일정"');
      expect(value).not.toContain("이어 배정 시험 일정");
    }
  });
});
