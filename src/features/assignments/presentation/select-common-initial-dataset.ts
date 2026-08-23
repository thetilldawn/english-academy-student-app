import type { AssignmentStudentItem } from "../catalog-types";

export function selectCommonInitialDatasetId(
  students: readonly AssignmentStudentItem[],
  readyDatasetIds: ReadonlySet<string>,
) {
  const selected = new Set(
    students
      .map((student) => student.currentVocabDatasetId)
      .filter((value): value is string => Boolean(value)),
  );
  const only = [...selected][0];
  return selected.size === 1 && only && readyDatasetIds.has(only) ? only : "";
}
