import type { SchoolScheduleBundle } from "./contracts/school-schedule";
export const fakeSchoolBundle: SchoolScheduleBundle = {
  schoolKey: "J10:9999999", schoolName: "가상고등학교", schoolLevel: "고", academicYear: 2026, semester: 2,
  versionId: "fake-2026-2-v1", sourceHash: "a".repeat(64), checkedOn: "2026-09-01",
  events: [
    { id: "fake-W1", grade: 2, kind: "written", round: 1, title: "2학기 1차 시험", subject: null,
      startDate: "2026-10-12", endDate: "2026-10-16", status: "confirmed", precision: "range", dateText: "10월 12~16일",
      maxPoints: null, applicability: "grade", sourceUrl: "https://school.example.invalid/exam" },
    { id: "fake-P1", grade: 2, kind: "performance", round: null, title: "가상 글쓰기 평가", subject: "영어Ⅱ",
      startDate: null, endDate: null, status: "unknown", precision: "unknown", dateText: "",
      maxPoints: 25, applicability: "enrollment-unconfirmed", sourceUrl: "https://school.example.invalid/performance" },
    { id: "fake-W2", grade: 3, kind: "written", round: 2, title: "2학기 2차 시험", subject: null,
      startDate: null, endDate: null, status: "not-held", precision: "none", dateText: "미실시",
      maxPoints: null, applicability: "grade", sourceUrl: "https://school.example.invalid/exam" },
  ],
};
