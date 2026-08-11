import type { AssignmentHistorySummary } from "@/lib/admin/history";
import {
  activityNeedsRetry,
  compareLearningActivities,
} from "@/features/history/domain/learning-activity";
import type { StudentLearningSourceItem } from "@/lib/admin/learning-sources";
import type { StudentSummary } from "@/lib/services/admin-service";
import {
  currentVocabWrongSummaryKey,
  emptyCurrentVocabWrongCounts,
  indexStudentCurrentVocabWrongSummaries,
} from "@/lib/admin/wrong-history-summary";

import type { StudentDirectoryFilters } from "../model";

export function indexStudentLearningSources(
  sources: readonly StudentLearningSourceItem[],
) {
  const index = new Map<string, StudentLearningSourceItem[]>();
  for (const source of sources) {
    const current = index.get(source.studentId) ?? [];
    current.push(source);
    index.set(source.studentId, current);
  }
  return index;
}

export function studentDirectoryFilterOptions(
  students: readonly StudentSummary[],
  sources: readonly StudentLearningSourceItem[],
) {
  const clean = (value: string | null | undefined): value is string =>
    Boolean(value?.trim());
  return {
    grades: Array.from(
      new Set(students.map((student) => student.gradeLabel).filter(clean)),
    ).toSorted(),
    schools: Array.from(
      new Set(students.map((student) => student.schoolName).filter(clean)),
    ).toSorted(),
    wordbooks: Array.from(
      new Set(
        [
          ...students.map((student) => student.currentVocabBook),
          ...sources.map((source) => source.displayLabel),
        ].filter(clean),
      ),
    ).toSorted(),
  };
}

export function filterAndSortStudents(input: {
  activitiesByStudent: ReadonlyMap<string, AssignmentHistorySummary[]>;
  currentWrongIndex: ReturnType<
    typeof indexStudentCurrentVocabWrongSummaries
  >;
  filters: StudentDirectoryFilters;
  learningSourcesByStudent: ReadonlyMap<string, StudentLearningSourceItem[]>;
  students: readonly StudentSummary[];
}) {
  const keyword = input.filters.query.trim().toLocaleLowerCase("ko-KR");
  return input.students
    .filter((student) => {
      const activities = input.activitiesByStudent.get(student.id) ?? [];
      const sources = input.learningSourcesByStudent.get(student.id) ?? [];
      const searchable = [
        student.displayName,
        student.schoolName,
        student.gradeLabel,
        student.currentVocabBook,
        ...sources.map((source) => source.displayLabel),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR");
      const matchesWrong = (() => {
        if (input.filters.wrong === "all") return true;
        if (input.filters.wrong === "retry") {
          return activities.some(activityNeedsRetry);
        }
        if (!student.currentVocabDatasetId) return false;
        const counts =
          input.currentWrongIndex.byStudentDataset.get(
            currentVocabWrongSummaryKey(
              student.id,
              student.currentVocabDatasetId,
            ),
          ) ?? emptyCurrentVocabWrongCounts();
        return input.filters.wrong === "repeated"
          ? counts.repeatedWrongWordCount > 0
          : counts.wrongWordCount > 0;
      })();
      return (
        (!keyword || searchable.includes(keyword)) &&
        (!input.filters.school ||
          student.schoolName === input.filters.school) &&
        (!input.filters.grade || student.gradeLabel === input.filters.grade) &&
        (!input.filters.wordbook ||
          student.currentVocabBook === input.filters.wordbook ||
          sources.some(
            (source) => source.displayLabel === input.filters.wordbook,
          )) &&
        matchesWrong
      );
    })
    .toSorted((left, right) => {
      const leftActivity = input.activitiesByStudent.get(left.id)?.[0] ?? null;
      const rightActivity = input.activitiesByStudent.get(right.id)?.[0] ?? null;
      if (leftActivity && rightActivity) {
        const order = compareLearningActivities(leftActivity, rightActivity);
        if (order !== 0) return order;
      } else if (leftActivity) {
        return -1;
      } else if (rightActivity) {
        return 1;
      }
      return left.displayName.localeCompare(right.displayName, "ko-KR");
    });
}
