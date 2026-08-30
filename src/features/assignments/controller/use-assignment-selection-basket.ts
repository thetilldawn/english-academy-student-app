"use client";

import { useMemo, useState } from "react";

import type { StudentDirectoryListItem } from "@/features/students/public-contracts";
import type { AssignmentSelectionStudent } from "../contracts/assignment-workspace-read-model";

export type FilterSelectionIntent = "select" | "deselect";

type ApplyFilterSelectionResult =
  | { ok: true; selectedCount: number }
  | { ok: false; selectedCount: number };

function toSelectionStudent(
  student: StudentDirectoryListItem,
): AssignmentSelectionStudent {
  return {
    currentVocabBook: student.currentVocabBook,
    displayName: student.displayName,
    gradeLabel: student.gradeLabel,
    id: student.id,
    schoolName: student.schoolName,
  };
}

export function useAssignmentSelectionBasket() {
  const [selectedById, setSelectedById] = useState(
    () => new Map<string, AssignmentSelectionStudent>(),
  );
  const [resolvedFilterIds, setResolvedFilterIds] = useState(
    () => new Map<string, ReadonlySet<string>>(),
  );
  const students = useMemo(() => [...selectedById.values()], [selectedById]);

  function toggle(student: StudentDirectoryListItem | AssignmentSelectionStudent) {
    setSelectedById((current) => {
      const next = new Map(current);
      if (next.has(student.id)) next.delete(student.id);
      else next.set(
        student.id,
        "codeStatus" in student ? toSelectionStudent(student) : student,
      );
      return next;
    });
  }

  function applyFilterSelection(
    filterKey: string,
    matchingStudents: readonly AssignmentSelectionStudent[],
    intent: FilterSelectionIntent,
    maximumSelectionCount: number,
  ): ApplyFilterSelectionResult {
    const matchingIds = new Set(matchingStudents.map((student) => student.id));
    const next = new Map(selectedById);
    if (intent === "deselect") {
      for (const studentId of matchingIds) next.delete(studentId);
    } else {
      for (const student of matchingStudents) next.set(student.id, student);
      if (next.size > maximumSelectionCount) {
        return { ok: false, selectedCount: selectedById.size };
      }
    }
    setResolvedFilterIds((current) => {
      const nextResolved = new Map(current);
      nextResolved.set(filterKey, matchingIds);
      return nextResolved;
    });
    setSelectedById(next);
    return { ok: true, selectedCount: next.size };
  }

  function containsFilterSelection(filterKey: string) {
    const ids = resolvedFilterIds.get(filterKey);
    return Boolean(
      ids && ids.size > 0 && [...ids].every((studentId) => selectedById.has(studentId)),
    );
  }

  function isExactFilterSelection(filterKey: string) {
    const ids = resolvedFilterIds.get(filterKey);
    return Boolean(
      ids &&
        ids.size > 0 &&
        ids.size === selectedById.size &&
        [...ids].every((studentId) => selectedById.has(studentId)),
    );
  }

  return {
    containsFilterSelection,
    isExactFilterSelection,
    selectedById,
    students,
    actions: {
      applyFilterSelection,
      clear: () => setSelectedById(new Map()),
      toggle,
    },
  };
}
