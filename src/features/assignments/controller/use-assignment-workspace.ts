"use client";

import { useMemo, useReducer, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  activityNeedsRetry,
  compareLearningActivities,
  studentLearningActivityIndex,
} from "@/features/history/domain/learning-activity";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { indexVocabAssignmentQueuesByStudent } from "@/lib/admin/vocab-assignment-queue";
import {
  availableReviewCount,
  emptyPendingReviewCounts,
  indexStudentPendingReviewSummaries,
  pendingReviewCount,
  pendingReviewSummaryKey,
} from "@/lib/admin/review-queue-summary";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";
import {
  currentVocabWrongSummaryKey,
  emptyCurrentVocabWrongCounts,
  indexStudentCurrentVocabWrongSummaries,
} from "@/lib/admin/wrong-history-summary";

import type {
  AssignmentLearningSourceItem,
  AssignmentStudentItem,
} from "../catalog-types";
import { assignmentDirectoryOptions } from "../presentation/assignment-directory-options";

export type WrongWordStudentFilter = "all" | "wrong" | "repeated" | "retry";
export type AssignmentDialogView = "overview" | "assign";
export type AssignmentEntryMode = "student" | "school" | "dataset";
export type AssignmentSelectionMode = "single" | "bulk";

export type AssignmentWorkspaceFilters = {
  classGroup: string;
  grade: string;
  query: string;
  school: string;
  status: "active" | "blocked";
  wordbook: string;
  wrongWord: WrongWordStudentFilter;
};

export function useAssignmentWorkspace({
  data,
  initialDatasetId,
  initialDialogView,
  initialStudentId,
}: {
  data: AssignmentManagerData;
  initialDatasetId: string;
  initialDialogView: AssignmentDialogView;
  initialStudentId: string;
}) {
  const router = useRouter();
  const [, startRefreshTransition] = useTransition();
  const readyDatasets = useMemo(
    () =>
      data.datasets.filter(
        (dataset) =>
          dataset.status === "ready" &&
          dataset.isActive &&
          dataset.isAssignable,
      ),
    [data.datasets],
  );
  const activeStudents = useMemo(
    () => data.students.filter((student) => student.status === "active"),
    [data.students],
  );
  const progressByStudent = useMemo(
    () => new Map(data.progress.map((item) => [item.studentId, item])),
    [data.progress],
  );
  const pendingReviewIndex = useMemo(
    () => indexStudentPendingReviewSummaries(data.pendingReviewSummaries),
    [data.pendingReviewSummaries],
  );
  const currentVocabWrongIndex = useMemo(
    () => indexStudentCurrentVocabWrongSummaries(data.currentVocabWrongSummaries),
    [data.currentVocabWrongSummaries],
  );
  const activitiesByStudent = useMemo(
    () => studentLearningActivityIndex(data.history),
    [data.history],
  );
  const assignmentQueuesByStudent = useMemo(
    () => indexVocabAssignmentQueuesByStudent(data.assignmentQueues ?? []),
    [data.assignmentQueues],
  );
  const learningSourcesByStudent = useMemo(() => {
    const index = new Map<string, AssignmentLearningSourceItem[]>();
    for (const source of data.learningSources) {
      const current = index.get(source.studentId) ?? [];
      current.push(source);
      index.set(source.studentId, current);
    }
    return index;
  }, [data.learningSources]);
  const initialStudent =
    activeStudents.find((student) => student.id === initialStudentId) ?? null;

  const [entryMode, setEntryMode] = useReducer(
    (_current: AssignmentEntryMode, next: AssignmentEntryMode) => next,
    "student",
  );
  const [entryDatasetId, setEntryDatasetId] = useReducer(
    (_current: string, next: string) => next,
    readyDatasets.some((dataset) => dataset.id === initialDatasetId)
      ? initialDatasetId
      : "",
  );
  const [filters, setFilters] = useState<AssignmentWorkspaceFilters>({
    classGroup: "",
    grade: "",
    query: "",
    school: "",
    status: "active",
    wordbook: "",
    wrongWord: "all",
  });
  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentSelectionMode>("single");
  const [selectedBulkStudentIds, setSelectedBulkStudentIds] = useState<string[]>([]);
  const [plannerStudentIds, setPlannerStudentIds] = useState<string[]>(
    initialStudent && initialDialogView === "assign" ? [initialStudent.id] : [],
  );
  const [plannerOpen, setPlannerOpen] = useState(
    Boolean(initialStudent && initialDialogView === "assign"),
  );

  const directoryOptions = useMemo(
    () => assignmentDirectoryOptions(data.students, data.learningSources),
    [data.learningSources, data.students],
  );
  const filteredStudents = useMemo(() => {
    const keyword = filters.query.trim().toLocaleLowerCase("ko-KR");
    const selectedGroup = data.classGroups.find(
      (group) => group.id === filters.classGroup,
    );
    const groupStudentIds = new Set(selectedGroup?.studentIds ?? []);
    return data.students
      .filter((student) => {
        if (student.status !== filters.status) return false;
        const searchText = [
          student.displayName,
          student.schoolName,
          student.gradeLabel,
          student.currentVocabBook,
          ...(learningSourcesByStudent.get(student.id) ?? []).map(
            (source) => source.displayLabel,
          ),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("ko-KR");
        if (keyword && !searchText.includes(keyword)) return false;
        if (filters.school && student.schoolName !== filters.school) return false;
        if (filters.grade && student.gradeLabel !== filters.grade) return false;
        if (filters.classGroup && !groupStudentIds.has(student.id)) return false;
        if (
          filters.wordbook &&
          student.currentVocabBook !== filters.wordbook &&
          !(learningSourcesByStudent.get(student.id) ?? []).some(
            (source) => source.displayLabel === filters.wordbook,
          )
        ) {
          return false;
        }
        if (filters.wrongWord === "all") return true;
        if (filters.wrongWord === "retry") {
          return (activitiesByStudent.get(student.id) ?? []).some(
            activityNeedsRetry,
          );
        }
        if (!student.currentVocabDatasetId) return false;
        const wrongCounts =
          currentVocabWrongIndex.byStudentDataset.get(
            currentVocabWrongSummaryKey(
              student.id,
              student.currentVocabDatasetId,
            ),
          ) ?? emptyCurrentVocabWrongCounts();
        return filters.wrongWord === "repeated"
          ? wrongCounts.repeatedWrongWordCount > 0
          : wrongCounts.wrongWordCount > 0;
      })
      .toSorted((left, right) => {
        const leftActivity = activitiesByStudent.get(left.id)?.[0] ?? null;
        const rightActivity = activitiesByStudent.get(right.id)?.[0] ?? null;
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
  }, [
    activitiesByStudent,
    currentVocabWrongIndex,
    data.classGroups,
    data.students,
    filters,
    learningSourcesByStudent,
  ]);
  const selectedBulkStudents = useMemo(
    () =>
      selectedBulkStudentIds.flatMap((selectedId) => {
        const student = activeStudents.find(
          (candidate) => candidate.id === selectedId,
        );
        return student ? [student] : [];
      }),
    [activeStudents, selectedBulkStudentIds],
  );
  const plannerStudents = useMemo(
    () =>
      plannerStudentIds.flatMap((selectedId) => {
        const student = activeStudents.find(
          (candidate) => candidate.id === selectedId,
        );
        return student ? [student] : [];
      }),
    [activeStudents, plannerStudentIds],
  );
  const canPrepareBulk =
    selectedBulkStudents.length > 0 &&
    readyDatasets.length > 0 &&
    (entryMode === "student" ||
      (entryMode === "school" &&
        Boolean(filters.school) &&
        selectedBulkStudents.every(
          (student) => student.schoolName === filters.school,
        )) ||
      (entryMode === "dataset" && Boolean(entryDatasetId)));
  const allFilteredStudentsSelected =
    filteredStudents.some((student) => student.status === "active") &&
    filteredStudents
      .filter((student) => student.status === "active")
      .every((student) =>
      selectedBulkStudentIds.includes(student.id),
    );
  function setFilter<Key extends keyof AssignmentWorkspaceFilters>(
    key: Key,
    value: AssignmentWorkspaceFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setFilters({
      classGroup: "",
      grade: "",
      query: "",
      school: "",
      status: "active",
      wordbook: "",
      wrongWord: "all",
    });
  }

  function toggleBulkStudent(studentId: string) {
    if (!activeStudents.some((student) => student.id === studentId)) return;
    setSelectedBulkStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((candidate) => candidate !== studentId)
        : [...current, studentId],
    );
  }

  function toggleFilteredStudents() {
    const filteredIds = new Set(
      filteredStudents
        .filter((student) => student.status === "active")
        .map((student) => student.id),
    );
    setSelectedBulkStudentIds((current) =>
      allFilteredStudentsSelected
        ? current.filter((studentId) => !filteredIds.has(studentId))
        : Array.from(new Set([...current, ...filteredIds])),
    );
  }

  function changeAssignmentMode(mode: AssignmentSelectionMode) {
    setAssignmentMode(mode);
    setPlannerOpen(false);
    setPlannerStudentIds([]);
  }

  function openSingleAssignment(studentId: string) {
    if (!activeStudents.some((student) => student.id === studentId)) return;
    setPlannerStudentIds([studentId]);
    setPlannerOpen(true);
  }

  function prepareBulkAssignment() {
    if (!canPrepareBulk) return;
    setPlannerStudentIds(selectedBulkStudentIds);
    setPlannerOpen(true);
  }

  function closePlanner() {
    setPlannerOpen(false);
    setPlannerStudentIds([]);
  }

  function refresh() {
    startRefreshTransition(() => router.refresh());
  }

  return {
    actions: {
      changeAssignmentMode,
      clearBulkStudents: () => setSelectedBulkStudentIds([]),
      closePlanner,
      openSingleAssignment,
      prepareBulkAssignment,
      refresh,
      resetFilters,
      setEntryDatasetId,
      setEntryMode,
      setFilter,
      toggleBulkStudent,
      toggleFilteredStudents,
    },
    activeStudents,
    activitiesByStudent,
    assignmentQueuesByStudent,
    allFilteredStudentsSelected,
    assignmentMode,
    canPrepareBulk,
    classGroupOptions: data.classGroups.map((group) => ({
      label: group.name,
      value: group.id,
    })),
    data,
    entryDatasetId,
    entryMode,
    filteredStudents,
    filters,
    gradeOptions: directoryOptions.grades,
    learningSourcesByStudent,
    pendingReviewIndex,
    plannerOpen,
    plannerStudents,
    progressByStudent,
    readyDatasets,
    schoolOptions: directoryOptions.schools,
    selectedBulkStudentIds,
    selectedBulkStudents,
    wordbookOptions: directoryOptions.wordbooks,
    currentVocabWrongIndex,
  };
}

export type AssignmentWorkspaceController = ReturnType<
  typeof useAssignmentWorkspace
>;

export function studentPendingReviewCounts(
  controller: AssignmentWorkspaceController,
  student: AssignmentStudentItem,
) {
  const counts = student.currentVocabDatasetId
    ? (controller.pendingReviewIndex.byStudentDataset.get(
        pendingReviewSummaryKey(student.id, student.currentVocabDatasetId),
      ) ?? emptyPendingReviewCounts())
    : emptyPendingReviewCounts();
  return {
    available: availableReviewCount(counts),
    pending: pendingReviewCount(counts),
  };
}

export function studentActivities(
  controller: AssignmentWorkspaceController,
  studentId: string,
): AssignmentHistorySummary[] {
  return controller.activitiesByStudent.get(studentId) ?? [];
}
