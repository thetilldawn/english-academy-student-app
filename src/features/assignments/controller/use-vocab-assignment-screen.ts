"use client";

import { useMemo, useState } from "react";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { StudentPendingReviewSummary } from "@/lib/admin/review-queue-summary";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
  AssignmentUnitItem,
} from "../catalog-types";
import {
  toVocabTimeTemplate,
  type VocabTimeTemplateRecord,
} from "../api/vocab-time-template-adapter";
import { selectCommonInitialDatasetId } from "../presentation/select-common-initial-dataset";
import type { AssignmentTransport } from "./assignment-transport";
import { useVocabAssignmentPlanner } from "./use-vocab-assignment-planner";

export type VocabAssignmentScreenData = {
  datasets: readonly AssignmentDatasetItem[];
  history: readonly AssignmentHistorySummary[];
  pendingReviewSummaries?: readonly StudentPendingReviewSummary[];
  timeTemplates: readonly VocabTimeTemplateRecord[];
  units: readonly AssignmentUnitItem[];
};

export function summarizeVocabAssignmentResult(
  assignments: readonly {
    student_id: string;
    assignment_id?: string | null;
    status?: "assigned" | "queued";
  }[],
) {
  const queuedCount = assignments.filter(
    (item) => item.status === "queued" || item.assignment_id === null,
  ).length;
  return {
    assignmentCount: assignments.length - queuedCount,
    queuedCount,
    studentCount: new Set(assignments.map((item) => item.student_id)).size,
  };
}

export function useVocabAssignmentScreen({
  data,
  genericErrorMessage,
  initialDatasetId,
  previewErrorMessage,
  students,
  today: todayOverride,
  transport,
}: {
  data: VocabAssignmentScreenData;
  genericErrorMessage: string;
  initialDatasetId: string;
  previewErrorMessage: string;
  students: readonly AssignmentStudentItem[];
  today?: string;
  transport?: AssignmentTransport;
}) {
  const [initialLocalDateTime] = useState(
    () =>
      todayOverride
        ? `${todayOverride}T00:00`
        : isoToKoreanDateTimeLocal(new Date().toISOString()).slice(0, 16),
  );
  const today = initialLocalDateTime.slice(0, 10);
  const [previousExamSourceStudentId, setPreviousExamSourceStudentId] =
    useState(() => students[0]?.id ?? "");
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
  const readyDatasetIds = useMemo(
    () => new Set(readyDatasets.map((dataset) => dataset.id)),
    [readyDatasets],
  );
  const resolvedInitialDatasetId =
    initialDatasetId && readyDatasetIds.has(initialDatasetId)
      ? initialDatasetId
      : selectCommonInitialDatasetId(students, readyDatasetIds);
  const initialTimeTemplates = useMemo(
    () => data.timeTemplates.map(toVocabTimeTemplate),
    [data.timeTemplates],
  );
  const studentIds = useMemo(
    () => students.map((student) => student.id),
    [students],
  );
  const planner = useVocabAssignmentPlanner({
    datasets: readyDatasets,
    genericErrorMessage,
    initialDatasetId: resolvedInitialDatasetId,
    initialTimeTemplates,
    previousExamHistory: data.history,
    previousExamSourceStudentId,
    previewErrorMessage,
    studentIds,
    today,
    currentLocalDateTime: initialLocalDateTime,
    transport,
    units: data.units,
  });

  async function submitPlan() {
    if (planner.canSubmit === false) {
      return {
        conflict: false,
        message: planner.blockedReason ?? "배정 조건을 확인해 주세요.",
        ok: false as const,
      };
    }
    const outcome = await planner.bulk.actions.submit();
    return outcome.ok
      ? {
          ok: true as const,
          result: summarizeVocabAssignmentResult(outcome.result.assignments),
        }
      : outcome;
  }

  return {
    ...planner,
    actions: {
      ...planner.actions,
      changePreviousExamSourceStudentId: setPreviousExamSourceStudentId,
      submitPlan,
    },
    previousExamSourceStudentId,
    readyDatasets,
  };
}

export type VocabAssignmentScreenController = ReturnType<typeof useVocabAssignmentScreen>;
