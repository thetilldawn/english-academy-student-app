import { differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import type { SchoolScheduleBundle, SchoolScheduleSummary } from "../contracts/school-schedule";

export function schoolToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function schoolDisplayPeriod(today: string) {
  const month = Number(today.slice(5, 7));
  return { academicYear: Number(today.slice(0, 4)) - (month < 3 ? 1 : 0), semester: month < 3 || month >= 8 ? 2 : 1 };
}
export function buildSchoolSummary(profile: { schoolKey: string | null; schoolName: string | null; gradeLabel: string | null }, bundles: SchoolScheduleBundle[], today: string): SchoolScheduleSummary {
  const base = { ...profile, today, events: [] };
  if (!profile.schoolName || !profile.gradeLabel) return { ...base, status: "missing-profile" };
  if (!profile.schoolKey) return { ...base, status: "unlinked" };
  const grade = /^(중|고)([123])(?:학년)?$/.exec(profile.gradeLabel.replace(/\s/g, ""));
  if (!grade) return { ...base, status: "missing-profile" };
  const { academicYear, semester: currentSemester } = schoolDisplayPeriod(today);
  const applicable = bundles.filter(bundle => bundle.schoolKey === profile.schoolKey && bundle.schoolLevel === grade[1]
    && bundle.academicYear === academicYear);
  if (!applicable.length) return { ...base, status: "unregistered" };
  // Semester is a display scope, never a substitute for a confirmed exam date.
  // Keep dated events across semesters; apply the academy's semester scope only to undated tasks.
  const events = applicable.flatMap(bundle =>
    bundle.events.filter(event => event.grade === Number(grade[2]) && (event.startDate !== null || bundle.semester === currentSemester))
      .map(event => ({ ...event, semester: bundle.semester, academicYear: bundle.academicYear, checkedOn: bundle.checkedOn })));
  return { ...base, status: "ready", events };
}
export function nearestSchoolExam(summary: SchoolScheduleSummary) {
  if (summary.status !== "ready") return null;
  const exam = summary.events.filter(event => event.kind === "written" && event.status === "confirmed"
    && event.startDate && event.endDate && event.endDate >= summary.today)
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!) || a.id.localeCompare(b.id))[0];
  if (!exam) return null;
  const days = Math.max(0, differenceInCalendarDays(parseISO(exam.startDate!), parseISO(summary.today)));
  const weeks = Number((days / 7).toFixed(1));
  const during = exam.startDate! <= summary.today;
  return { exam, days, weeks, label: `${exam.semester}-${exam.round} | ${during ? "시험 중" : `${days}일 [${weeks}주]`}` };
}
export function scheduleWeek(date: string) { return format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd"); }
export function shortSchoolDate(date: string) { return format(parseISO(date), "M/d"); }
export function scheduleStatusText(status: SchoolScheduleSummary["status"], studentViewer = false) {
  switch (status) {
    case "missing-profile": return studentViewer ? "선생님께 학교·학년 등록을 요청해 주세요." : "학교·학년을 등록하면 시험 일정을 확인할 수 있습니다.";
    case "unlinked": return studentViewer ? "선생님께 학교 연결을 요청해 주세요." : "학생 정보에서 학교를 검색해 선택해 주세요.";
    case "unregistered": return "등록된 학교 일정이 없습니다.";
    case "error": return "학교 일정을 불러오지 못했습니다. 다시 시도해 주세요.";
    case "ready": return "예정된 지필시험이 없습니다.";
  }
}
