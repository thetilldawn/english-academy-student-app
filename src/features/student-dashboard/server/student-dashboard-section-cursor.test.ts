import { expect, it } from "vitest";
import { encodeStudentDashboardSectionCursor,decodeStudentDashboardSectionCursor,type StudentDashboardSectionCursor } from "./student-dashboard-section-cursor";
import { studentDashboardStudentFingerprint } from "./student-dashboard-cursor";
const student="10000000-0000-4000-8000-000000000001";
const cursor:StudentDashboardSectionCursor={version:3,section:"scheduled",assignmentId:student,sortBucket:0,sortAt:"2027-01-01T00:00:00.123456Z",secondarySortAt:"-infinity",effectiveAt:"2026-09-01T00:00:00.123456Z",snapshotAt:"2026-09-29T00:00:00.123456Z",studentFingerprint:studentDashboardStudentFingerprint(student)};
it("미래 공개와 마이크로초를 손실 없이 왕복한다",()=>expect(decodeStudentDashboardSectionCursor(encodeStudentDashboardSectionCursor(cursor),student)).toEqual(cursor));
it("마감 없음도 정확히 왕복한다",()=>expect(decodeStudentDashboardSectionCursor(encodeStudentDashboardSectionCursor({...cursor,sortAt:"infinity"}),student).sortAt).toBe("infinity"));
it("다른 학생의 커서와 잘못된 형식을 거절한다",()=>{
expect(()=>decodeStudentDashboardSectionCursor(encodeStudentDashboardSectionCursor(cursor),student.replace(/1$/,"2"))).toThrow("학생 정보가 바뀌었습니다");
expect(()=>decodeStudentDashboardSectionCursor("bad",student)).toThrow();
expect(()=>decodeStudentDashboardSectionCursor(encodeStudentDashboardSectionCursor({...cursor,effectiveAt:"2027-01-01T00:00:00Z"}),student)).toThrow();
});
