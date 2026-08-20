"use client";

import { useMemo, useState } from "react";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
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
import {
  MAX_VOCAB_SCHEDULE_RANGE_DAYS,
  shiftCalendarDate,
} from "../domain/vocab-assignment-plan";
import type { AssignmentTransport } from "./assignment-transport";
import { useVocabAssignmentPlanner } from "./use-vocab-assignment-planner";

export type VocabAssignmentScreenData = {
  datasets: readonly AssignmentDatasetItem[];
  history: readonly AssignmentHistorySummary[];
  timeTemplates: readonly VocabTimeTemplateRecord[];
  units: readonly AssignmentUnitItem[];
};

function selectCommonInitialDatasetId(
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

export function summarizeVocabAssignmentResult(
  assignments: readonly { student_id: string }[],
) {
  return {
    assignmentCount: assignments.length,
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
  const [today] = useState(
    () =>
      todayOverride ??
      isoToKoreanDateTimeLocal(new Date().toISOString()).slice(0, 10),
  );
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
    transport,
    units: data.units,
  });

  async function submitPlan() {
    const outcome = await planner.bulk.actions.submit();
    return outcome.ok
      ? { ok: true as const, result: summarizeVocabAssignmentResult(outcome.result.assignments) }
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
    maximumScheduleEndDate:
      shiftCalendarDate(
        planner.planner.schedule.startDate,
        MAX_VOCAB_SCHEDULE_RANGE_DAYS,
      ) ?? planner.planner.schedule.startDate,
  };
}

export type VocabAssignmentScreenController = ReturnType<
  typeof useVocabAssignmentScreen
>;
