import { expect, it } from "vitest";
import { assignmentStudentContext } from "./assignment-student-context";
const student = { id: "a", schoolName: "가상고", gradeLabel: "고2" };
const now = new Date("2026-09-21T01:00:00Z");
it("학교·학년과 현재 학기를 기본 선택하고 자료 종류는 전체로 둔다", () => {
  expect(assignmentStudentContext([student], now)).toMatchObject({ filters: { school: "school:가상고", grade: "g11", semester: "2", kind: "all", stage: "all" }, target: { school: "가상고", targetGrade: "g11", semester: 2, schoolYear: 2026 } });
});
it("여러 학생의 공통 조건만 사용하고 바구니 순서는 영향을 주지 않는다", () => {
  const other = { ...student, id: "b", schoolName: "다른고", gradeLabel: "고3" };
  expect(assignmentStudentContext([student, other], now).filters).toMatchObject({ school: "all", grade: "all" });
  expect(assignmentStudentContext([student, other], now).key).toBe(assignmentStudentContext([other, student], now).key);
  expect(assignmentStudentContext([student, { ...other, schoolName: " 가상고 ", gradeLabel: "h2" }], now).filters).toMatchObject({ school: "school:가상고", grade: "g11" });
});
it("한국 날짜의 학기 경계와 지정한 시험 학기를 사용한다", () => {
  expect(assignmentStudentContext([student], new Date("2026-02-28T14:59:59Z")).target).toMatchObject({ schoolYear: 2025, semester: 2 });
  expect(assignmentStudentContext([student], new Date("2026-02-28T15:00:00Z")).target).toMatchObject({ schoolYear: 2026, semester: 1 });
  expect(assignmentStudentContext([student], new Date("2026-07-31T15:00:00Z")).target.semester).toBe(2);
  expect(assignmentStudentContext([student], now, 1).filters.semester).toBe("1");
});
it("학년의 학교급이나 빈 학교를 추정하지 않는다", () => {
  expect(assignmentStudentContext([{ ...student, schoolName: null, gradeLabel: "2학년" }], now).filters).toMatchObject({ school: "all", grade: "all" });
});
