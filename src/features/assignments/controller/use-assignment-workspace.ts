"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import type { StudentDirectoryFilters } from "@/features/students/public-contracts";
import type {
  AssignmentSelectionStudent,
  AssignmentWorkspaceInitial,
} from "../contracts/assignment-workspace-read-model";
import { MAXIMUM_BULK_STUDENT_COUNT } from "../domain/model";
import { buildBulkStudentFilterLabels } from "../presentation/bulk-student-selection-summary";
import { loadAssignmentDirectorySelection } from "../transport/assignment-workspace-reads";
import { useAssignmentDatasetDirectory } from "./use-assignment-dataset-directory";
import { useAssignmentPlannerPreparation } from "./use-assignment-planner-preparation";
import { useAssignmentSelectionBasket } from "./use-assignment-selection-basket";
import { useAssignmentStudentDirectory } from "./use-assignment-student-directory";

export type AssignmentDialogView = "overview" | "assign";
export type AssignmentEntryMode = "student" | "school" | "dataset";
export type AssignmentSelectionMode = "single" | "bulk";

function selectionFilterKey(
  filters: StudentDirectoryFilters,
  snapshotAt: string,
) {
  return JSON.stringify({ filters, snapshotAt });
}

export function useAssignmentWorkspace({
  initial,
  initialDatasetId,
  initialDialogView,
  initialStudentId,
}: {
  initial: AssignmentWorkspaceInitial;
  initialDatasetId: string;
  initialDialogView: AssignmentDialogView;
  initialStudentId: string;
}) {
  const router = useRouter();
  const [, startRefreshTransition] = useTransition();
  const directory = useAssignmentStudentDirectory(initial.directory);
  const basket = useAssignmentSelectionBasket();
  const datasetDirectory = useAssignmentDatasetDirectory();
  const ensureDatasetDirectory = datasetDirectory.actions.ensure;
  const planner = useAssignmentPlannerPreparation();
  const openPlanner = planner.actions.open;
  const initialOpenHandledRef = useRef(false);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [entryMode, setEntryMode] = useReducer(
    (_current: AssignmentEntryMode, next: AssignmentEntryMode) => next,
    initialDatasetId && !initialStudentId ? "dataset" : "student",
  );
  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentSelectionMode>("single");
  const [entryDatasetId, setEntryDatasetId] = useState(() =>
    initialDatasetId && !initialStudentId ? initialDatasetId : ""
  );

  const filters = directory.filters;
  const filterOptions = directory.snapshot.filterOptions;
  const currentFilterKey = selectionFilterKey(
    directory.snapshot.filters,
    directory.snapshot.snapshotAt,
  );
  const allFilteredStudentsSelected = basket.containsFilterSelection(currentFilterKey);
  const exactlyFilteredStudentsSelected = basket.isExactFilterSelection(
    currentFilterKey,
  );
  const selectedBulkStudents = basket.students;
  const selectedBulkStudentIds = selectedBulkStudents.map((student) => student.id);
  const entryDatasetAvailable = datasetDirectory.status === "ready" &&
    datasetDirectory.datasets.some((dataset) => dataset.id === entryDatasetId);
  const canPrepareBulk = !selectionLoading &&
    selectedBulkStudents.length > 0 &&
    selectedBulkStudents.length <= MAXIMUM_BULK_STUDENT_COUNT &&
    (entryMode === "student" ||
      (entryMode === "dataset" && entryDatasetAvailable) ||
      (Boolean(filters.school) && selectedBulkStudents.every(
        (student) => student.schoolName === filters.school,
      )));
  const classGroupOptions = filterOptions.classGroups.map((group) => ({
    label: group.name,
    value: group.id,
  }));

  const cancelDirectorySelection = useCallback(() => {
    selectionAbortRef.current?.abort();
    selectionAbortRef.current = null;
    setSelectionLoading(false);
  }, []);

  function replaceFilter<Key extends keyof StudentDirectoryFilters>(
    key: Key,
    value: StudentDirectoryFilters[Key],
  ) {
    cancelDirectorySelection();
    const next = { ...filters, [key]: value };
    if (key === "query") directory.actions.replaceQuery(String(value));
    else directory.actions.replaceFilters(next);
  }

  function resetFilters() {
    cancelDirectorySelection();
    directory.actions.replaceFilters({
      classGroupId: "",
      grade: "",
      query: filters.query,
      school: "",
      status: "active",
      wordbook: "",
      wrong: "all",
    });
  }

  async function toggleFilteredStudents() {
    if (selectionLoading || directory.filtering || filters.status !== "active") return;
    const intent = allFilteredStudentsSelected ? "deselect" : "select";
    selectionAbortRef.current?.abort();
    const abort = new AbortController();
    selectionAbortRef.current = abort;
    setSelectionLoading(true);
    setSelectionError("");
    try {
      const selection = await loadAssignmentDirectorySelection(
        {
          filters: directory.snapshot.filters,
          snapshotAt: directory.snapshot.snapshotAt,
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      const result = basket.actions.applyFilterSelection(
        currentFilterKey,
        selection.students,
        intent,
        MAXIMUM_BULK_STUDENT_COUNT,
      );
      if (!result.ok) {
        setSelectionError(
          `선택 바구니는 최대 ${MAXIMUM_BULK_STUDENT_COUNT}명까지 담을 수 있습니다. 기존 선택을 줄여 주세요.`,
        );
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        setSelectionError(
          error instanceof Error
            ? error.message
            : "선택할 학생을 불러오지 못했습니다.",
        );
      }
    } finally {
      if (!abort.signal.aborted) setSelectionLoading(false);
      if (selectionAbortRef.current === abort) selectionAbortRef.current = null;
    }
  }

  function changeAssignmentMode(mode: AssignmentSelectionMode) {
    setAssignmentMode(mode);
    planner.actions.close();
  }

  function changeEntryMode(mode: AssignmentEntryMode) {
    setEntryMode(mode);
    planner.actions.close();
    if (mode === "dataset") void ensureDatasetDirectory();
  }

  function openSingleAssignment(studentId: string) {
    void openPlanner({
      bulkFilterLabels: [],
      initialDatasetId,
      selectionMode: "single",
      studentIds: [studentId],
    });
  }

  function prepareBulkAssignment() {
    if (!canPrepareBulk) return;
    const bulkFilterLabels = buildBulkStudentFilterLabels({
      classGroupLabel: classGroupOptions.find(
        (option) => option.value === filters.classGroupId,
      )?.label ?? null,
      filters,
      isWholeFilteredSelection: exactlyFilteredStudentsSelected,
    });
    void openPlanner({
      bulkFilterLabels,
      initialDatasetId: entryMode === "dataset" ? entryDatasetId : "",
      selectionMode: "bulk",
      studentIds: selectedBulkStudentIds,
    });
  }

  function toggleBulkStudent(student: AssignmentSelectionStudent) {
    if (selectionLoading) return;
    const isSelected = basket.selectedById.has(student.id);
    if (!isSelected && basket.students.length >= MAXIMUM_BULK_STUDENT_COUNT) {
      setSelectionError(
        `한 번에 선택할 수 있는 학생은 ${MAXIMUM_BULK_STUDENT_COUNT}명까지입니다.`,
      );
      return;
    }
    setSelectionError("");
    basket.actions.toggle(student);
  }

  function clearBulkStudents() {
    if (selectionLoading) return;
    setSelectionError("");
    basket.actions.clear();
  }

  useEffect(() => {
    if (entryMode === "dataset") void ensureDatasetDirectory();
  }, [ensureDatasetDirectory, entryMode]);

  useEffect(() => {
    if (initialOpenHandledRef.current) return;
    initialOpenHandledRef.current = true;
    if (initialDialogView !== "assign" || !initialStudentId) return;
    void openPlanner({
      bulkFilterLabels: [],
      initialDatasetId,
      selectionMode: "single",
      studentIds: [initialStudentId],
    });
  }, [initialDatasetId, initialDialogView, initialStudentId, openPlanner]);

  useEffect(() => cancelDirectorySelection, [cancelDirectorySelection]);

  function refresh() {
    startRefreshTransition(() => router.refresh());
  }

  return {
    actions: {
      changeAssignmentMode,
      clearSearch: () => replaceFilter("query", ""),
      clearBulkStudents,
      closePlanner: planner.actions.close,
      loadMore: directory.actions.loadMore,
      openSingleAssignment,
      prepareBulkAssignment,
      refresh,
      resetFilters,
      setEntryDatasetId,
      setEntryMode: changeEntryMode,
      setFilter: replaceFilter,
      toggleBulkStudent,
      toggleFilteredStudents,
    },
    allFilteredStudentsSelected,
    assignmentMode,
    canPrepareBulk,
    classGroupOptions,
    directory,
    datasetDirectory,
    entryDatasetId,
    entryMode,
    filters,
    gradeOptions: filterOptions.grades,
    planner,
    schoolOptions: filterOptions.schools,
    selectedBulkStudentIds,
    selectedBulkStudents,
    selectionError,
    selectionLoading,
    wordbookOptions: filterOptions.wordbooks,
  };
}

export type AssignmentWorkspaceController = ReturnType<
  typeof useAssignmentWorkspace
>;
