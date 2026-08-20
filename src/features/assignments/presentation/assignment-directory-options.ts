import type {
  AssignmentLearningSourceItem,
  AssignmentStudentItem,
} from "../catalog-types";

function uniqueSorted(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).toSorted();
}

export function assignmentDirectoryOptions(
  students: readonly AssignmentStudentItem[],
  learningSources: readonly AssignmentLearningSourceItem[],
) {
  return {
    schools: uniqueSorted(students.map((student) => student.schoolName)),
    grades: uniqueSorted(students.map((student) => student.gradeLabel)),
    wordbooks: uniqueSorted([
      ...students.map((student) => student.currentVocabBook),
      ...learningSources.map((source) => source.displayLabel),
    ]),
  };
}
