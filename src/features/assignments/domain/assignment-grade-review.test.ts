import { describe, expect, it } from "vitest";
import { assignmentAudienceMode, assignmentGradeLabel, compareAssignmentGrades, normalizeAssignmentGrade } from "./assignment-grade-review";
import { createInitialBulkSeriesAssignmentDraft, reduceBulkSeriesAssignmentDraft } from "./bulk-draft";

describe("배정 학년 비교", () => {
  it.each([["고1", "g10"], ["고등학교 2학년", "g11"], [" h3 ", "g12"], ["G10", "g10"],
    ["중학교1학년", "g7"], ["중2", "g8"], ["m3", "g9"], ["ｈ１", "g10"]])("%s를 %s로 비교한다", (raw, code) => {
    expect(normalizeAssignmentGrade(raw)).toBe(code);
  });
  it.each([null, undefined, "", "1학년", "예비고1", "고4", "초6", "기초", "g13"])("불명확한 학년 %s는 임의로 판단하지 않는다", raw => {
    expect(normalizeAssignmentGrade(raw)).toBeNull();
  });
  it("확실히 다른 학생만 제외 후보로 만들고 미입력은 별도로 둔다", () => {
    expect(compareAssignmentGrades("h1", [{ id: "same", gradeLabel: "고1" }, { id: "different", gradeLabel: "중1" },
      { id: "unknown", gradeLabel: "1학년" }])).toEqual({ grade: "g10", mismatchedStudentIds: ["different"], unknownStudentIds: ["unknown"] });
    expect(compareAssignmentGrades(null, [{ id: "one", gradeLabel: "고1" }]).mismatchedStudentIds).toEqual([]);
    expect(assignmentGradeLabel("g11")).toBe("고2");
  });
  it("일괄 배정은 1명이 남아도 일괄이고 옛 요청은 인원수로 구별한다", () => {
    expect(assignmentAudienceMode("bulk", 1)).toBe("bulk");
    expect(assignmentAudienceMode("single", 1)).toBe("single");
    expect(assignmentAudienceMode(undefined, 1)).toBe("single");
    expect(assignmentAudienceMode(undefined, 2)).toBe("bulk");
  });
  it("대상이나 방식 변경은 앞선 확인을 지운다", () => {
    const initial = createInitialBulkSeriesAssignmentDraft({ audienceMode: "bulk", studentIds: ["a", "b"] });
    const reviewed = reduceBulkSeriesAssignmentDraft(initial, { type: "grade/acknowledged", token: "a".repeat(64) });
    expect(reviewed.gradeReviewToken).toBeDefined();
    expect(reduceBulkSeriesAssignmentDraft(reviewed, { type: "students/changed", studentIds: ["b"] })).toMatchObject({ audienceMode: "bulk", studentIds: ["b"], gradeReviewToken: undefined });
    expect(reduceBulkSeriesAssignmentDraft(reviewed, { type: "audience/changed", audienceMode: "single" }).gradeReviewToken).toBeUndefined();
  });
});
