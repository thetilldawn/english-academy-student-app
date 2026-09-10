export type AssignmentAudienceMode = "single" | "bulk";

const gradeLabels: Record<string, string> = {
  g7: "중1", g8: "중2", g9: "중3", g10: "고1", g11: "고2", g12: "고3",
};

/** Free-text grades are compared only when their school stage is explicit. */
export function normalizeAssignmentGrade(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, "") ?? "";
  if (Object.hasOwn(gradeLabels, normalized)) return normalized;
  const match = /^(m|h|중|중학교|고|고등학교)([1-3])(?:학년)?$/u.exec(normalized);
  if (!match) return null;
  return `g${Number(match[2]) + (["m", "중", "중학교"].includes(match[1]) ? 6 : 9)}`;
}

export function assignmentGradeLabel(code: string | null): string | null {
  return code ? gradeLabels[code] ?? null : null;
}

export function assignmentAudienceMode(mode: AssignmentAudienceMode | undefined, count: number): AssignmentAudienceMode {
  return mode ?? (count === 1 ? "single" : "bulk");
}

export function compareAssignmentGrades(
  datasetGrade: string | null | undefined,
  students: readonly { id: string; gradeLabel?: string | null }[],
) {
  const grade = normalizeAssignmentGrade(datasetGrade);
  const normalizedStudents = students.map(student => ({
    id: student.id, grade: normalizeAssignmentGrade(student.gradeLabel),
  }));
  return {
    grade,
    mismatchedStudentIds: normalizedStudents.filter(s => grade && s.grade && s.grade !== grade).map(s => s.id),
    unknownStudentIds: normalizedStudents.filter(s => !grade || !s.grade).map(s => s.id),
  };
}
