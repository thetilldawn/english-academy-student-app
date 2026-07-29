import type {
  AssignmentActivityStatus,
  AssignmentHistorySummary,
} from "@/lib/admin/history";

export type StudentProgressSummary = {
  studentId: string;
  latestAttemptId: string | null;
  latestAssignmentTitle: string | null;
  latestStatus: AssignmentActivityStatus | null;
  latestScore: number | null;
  latestInitialScore: number | null;
  latestFinalScore: number | null;
  latestPassed: boolean | null;
  latestUnitLabel: string | null;
  latestAttemptNumber: number | null;
  latestStartedAt: string | null;
  latestCompletedAt: string | null;
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendedUnitLabel: string | null;
  recommendationReason:
    | "first"
    | "assigned"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
    | "manual"
    | null;
};

type ProgressStudent = {
  id: string;
  currentVocabDatasetId: string | null;
};

type ProgressUnit = {
  id: string;
  datasetId: string;
  label: string;
  sortIndex: number;
};

function rangeLabel(labels: string[]) {
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return `${labels[0]}~${labels.at(-1)}`;
}

function activityTime(item: AssignmentHistorySummary) {
  const parsed = Date.parse(item.activityAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function recommendationPriority(item: AssignmentHistorySummary) {
  if (item.status === "in_progress") return 3;
  if (item.status === "not_started") return 2;
  return 1;
}

export function buildStudentProgress(
  students: ProgressStudent[],
  units: ProgressUnit[],
  history: AssignmentHistorySummary[],
): StudentProgressSummary[] {
  const latestOverallByStudent = new Map<
    string,
    AssignmentHistorySummary
  >();
  const latestCurrentDatasetByStudent = new Map<
    string,
    AssignmentHistorySummary
  >();
  const studentById = new Map(
    students.map((student) => [student.id, student]),
  );
  const unitsByDataset = new Map<string, ProgressUnit[]>();
  for (const unit of units) {
    const datasetUnits = unitsByDataset.get(unit.datasetId) ?? [];
    datasetUnits.push(unit);
    unitsByDataset.set(unit.datasetId, datasetUnits);
  }
  for (const datasetUnits of unitsByDataset.values()) {
    datasetUnits.sort((left, right) => left.sortIndex - right.sortIndex);
  }

  for (const item of history) {
    const currentLatest = latestOverallByStudent.get(item.studentId);
    if (
      !currentLatest ||
      activityTime(item) > activityTime(currentLatest)
    ) {
      latestOverallByStudent.set(item.studentId, item);
    }

    const student = studentById.get(item.studentId);
    if (student?.currentVocabDatasetId === item.datasetId) {
      const currentRecommendation =
        latestCurrentDatasetByStudent.get(item.studentId);
      if (
        !currentRecommendation ||
        recommendationPriority(item) >
          recommendationPriority(currentRecommendation) ||
        (recommendationPriority(item) ===
          recommendationPriority(currentRecommendation) &&
          activityTime(item) > activityTime(currentRecommendation))
      ) {
        latestCurrentDatasetByStudent.set(item.studentId, item);
      }
    }
  }

  return students.map((student) => {
    const latest = latestOverallByStudent.get(student.id) ?? null;
    const latestCurrent =
      latestCurrentDatasetByStudent.get(student.id) ?? null;
    const datasetUnits = student.currentVocabDatasetId
      ? (unitsByDataset.get(student.currentVocabDatasetId) ?? [])
      : [];

    let recommendedUnit: ProgressUnit | null =
      datasetUnits[0] ?? null;
    let recommendationReason:
      | StudentProgressSummary["recommendationReason"] =
      recommendedUnit ? "first" : null;

    if (latestCurrent && datasetUnits.length > 0) {
      if (latestCurrent.unitIds.length === 0) {
        recommendedUnit = null;
        recommendationReason = "manual";
      } else {
        const firstUnit = latestCurrent.unitIds[0]
          ? datasetUnits.find(
              (unit) => unit.id === latestCurrent.unitIds[0],
            ) ?? datasetUnits[0]!
          : datasetUnits[0];
        const lastUnitId = latestCurrent.unitIds.at(-1);
        const lastIndex = lastUnitId
          ? datasetUnits.findIndex((unit) => unit.id === lastUnitId)
          : -1;

        if (latestCurrent.status === "not_started") {
          recommendedUnit = firstUnit;
          recommendationReason = "assigned";
        } else if (latestCurrent.status === "in_progress") {
          recommendedUnit = firstUnit;
          recommendationReason = "resume";
        } else if (
          latestCurrent.status === "completed" &&
          latestCurrent.passed === true
        ) {
          recommendedUnit =
            lastIndex >= 0
              ? (datasetUnits[lastIndex + 1] ?? null)
              : null;
          recommendationReason = recommendedUnit ? "next" : "complete";
        } else {
          recommendedUnit = firstUnit;
          recommendationReason = "repeat";
        }
      }
    }

    return {
      studentId: student.id,
      latestAttemptId: latest?.attemptId ?? null,
      latestAssignmentTitle: latest?.assignmentTitle ?? null,
      latestStatus: latest?.status ?? null,
      latestScore:
        latest?.finalScore ?? latest?.initialScore ?? null,
      latestInitialScore: latest?.initialScore ?? null,
      latestFinalScore: latest?.finalScore ?? null,
      latestPassed: latest?.passed ?? null,
      latestUnitLabel: latest ? rangeLabel(latest.unitLabels) : null,
      latestAttemptNumber: latest?.attemptNumber ?? null,
      latestStartedAt: latest?.startedAt ?? null,
      latestCompletedAt: latest?.completedAt ?? null,
      recommendedDatasetId: student.currentVocabDatasetId,
      recommendedUnitId: recommendedUnit?.id ?? null,
      recommendedUnitLabel: recommendedUnit?.label ?? null,
      recommendationReason,
    };
  });
}
