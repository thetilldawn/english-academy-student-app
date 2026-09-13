import type { SchoolScheduleEvent } from "../contracts/school-schedule";

// National public reference, separate from school-supplied assessment records.
// Publication: Ministry of Education / KICE, 2026-03-31 implementation plan.
const confirmedCsat = [{ academicYear: 2026, examYear: 2027, date: "2026-11-19",
  sourceUrl: "https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=105756&lev=0&m=020", checkedOn: "2026-09-14" }];
export function nationalExams(academicYear: number, gradeLabel: string | null): SchoolScheduleEvent[] {
  if (!/^고3(?:학년)?$/.test((gradeLabel ?? "").replace(/\s/g, ""))) return [];
  return confirmedCsat.filter(exam => exam.academicYear === academicYear).map(exam => ({
    id: `national-csat-${exam.examYear}`, grade: 3, kind: "csat", round: null,
    title: `${exam.examYear}학년도 수능`, subject: null, startDate: exam.date, endDate: exam.date,
    precision: "day", status: "confirmed", dateText: exam.date, maxPoints: null,
    applicability: "grade", sourceUrl: exam.sourceUrl, sourceLabel: "교육부 시행계획",
    semester: 2, academicYear: exam.academicYear, checkedOn: exam.checkedOn,
  }));
}
