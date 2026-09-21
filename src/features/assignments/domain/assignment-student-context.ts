import { EMPTY_DATASET_FILTERS, type DatasetPickerFilters } from "./assignment-dataset-picker";
import { normalizeAssignmentGrade } from "./assignment-grade-review";

export function assignmentStudentContext(
  students: readonly { id: string; schoolName: string | null; gradeLabel: string | null }[],
  now = new Date(),
  examSemester?: 1 | 2,
) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", month: "numeric", year: "numeric" }).formatToParts(now);
  const month = Number(parts.find(p => p.type === "month")!.value);
  const year = Number(parts.find(p => p.type === "year")!.value);
  const semester = examSemester ?? (month >= 3 && month <= 7 ? 1 : 2);
  const common = (values: (string | null)[]) => values.length && values[0] && values.every(value => value === values[0]) ? values[0] : null;
  const school = common(students.map(s => s.schoolName?.trim() || null));
  const targetGrade = common(students.map(s => normalizeAssignmentGrade(s.gradeLabel)));
  const filters: DatasetPickerFilters = { ...EMPTY_DATASET_FILTERS,
    school: school ? `school:${school}` : "all", grade: targetGrade ?? "all",
    semester: students.length ? String(semester) as "1" | "2" : "all" };
  return {
    key: JSON.stringify(students.map(s => s.id).toSorted()),
    filters,
    target: { school, targetGrade, semester, schoolYear: month < 3 ? year - 1 : year },
  };
}
