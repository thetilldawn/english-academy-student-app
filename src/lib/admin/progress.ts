import type {
  AssignmentActivityStatus,
  AssignmentHistorySummary,
} from "@/lib/admin/history";
import { assignmentScopeLabel } from "@/lib/admin/history";
import {
  planNextUnitRange,
  resolveOrderedContiguousUnits,
} from "@/lib/admin/unit-range";

export type StudentProgressSummary = {
  studentId: string;
  latestAttemptId: string | null;
  latestAssignmentTitle: string | null;
  latestStatus: AssignmentActivityStatus | null;
  latestPhase: AssignmentHistorySummary["phase"];
  latestScore: number | null;
  latestInitialScore: number | null;
  latestFinalScore: number | null;
  latestPassingScore: number | null;
  latestRetryStartedAt: string | null;
  latestPassed: boolean | null;
  latestUnitLabel: string | null;
  latestAttemptNumber: number | null;
  latestStartedAt: string | null;
  latestCompletedAt: string | null;
  latestCompletedAssignmentTitle: string | null;
  latestCompletedInitialScore: number | null;
  latestCompletedFinalScore: number | null;
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendedUnitLabel: string | null;
  recommendedUnitIds: string[];
  recommendedUnitLabels: string[];
  recommendedDirection: 1 | -1;
  recommendedRangeTruncated: boolean;
  nextAssignmentBlockedReason: "scheduled" | null;
  nextAssignmentDefaults: StudentNextAssignmentDefaults | null;
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

export type StudentNextAssignmentDefaults = {
  availableUntil: string | null;
  basisAssignmentId: string | null;
  datasetId: string;
  englishToKoreanRatio: number;
  passingScore: number;
  questionOrderMode: "ascending" | "descending" | "random";
  questionTimeLimitSeconds: number | null;
  timeLimitSeconds: number;
  timingMode: AssignmentHistorySummary["timingMode"];
  unitIds: string[];
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

function activityTime(item: AssignmentHistorySummary) {
  const parsed = Date.parse(item.activityAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function recommendationPriority(item: AssignmentHistorySummary) {
  if (item.status === "in_progress") return 3;
  if (item.status === "not_started") return 2;
  return 1;
}

function assignmentSequenceTime(item: AssignmentHistorySummary) {
  const availableFrom = item.availableFrom
    ? Date.parse(item.availableFrom)
    : Number.NaN;
  if (Number.isFinite(availableFrom)) return availableFrom;
  const assignedAt = Date.parse(item.assignedAt);
  return Number.isFinite(assignedAt) ? assignedAt : 0;
}

function isLaterAssignment(
  candidate: AssignmentHistorySummary,
  current: AssignmentHistorySummary,
) {
  const candidateSequence = assignmentSequenceTime(candidate);
  const currentSequence = assignmentSequenceTime(current);
  if (candidateSequence !== currentSequence) {
    return candidateSequence > currentSequence;
  }

  const candidateAssignedAt = Date.parse(candidate.assignedAt) || 0;
  const currentAssignedAt = Date.parse(current.assignedAt) || 0;
  if (candidateAssignedAt !== currentAssignedAt) {
    return candidateAssignedAt > currentAssignedAt;
  }
  return candidate.assignmentId > current.assignmentId;
}

export function rollAssignmentDeadlineForward(
  assignedAt: string,
  availableUntil: string | null,
  nowMilliseconds: number,
  availableFrom: string | null = null,
) {
  if (!availableUntil) return null;
  const assignedMilliseconds = Date.parse(availableFrom ?? assignedAt);
  const deadlineMilliseconds = Date.parse(availableUntil);
  const duration = deadlineMilliseconds - assignedMilliseconds;
  if (
    !Number.isFinite(assignedMilliseconds) ||
    !Number.isFinite(deadlineMilliseconds) ||
    duration <= 0
  ) {
    return null;
  }
  const nextDeadline = nowMilliseconds + duration;
  return Number.isFinite(nextDeadline)
    ? new Date(nextDeadline).toISOString()
    : null;
}

export function buildStudentProgress(
  students: ProgressStudent[],
  units: ProgressUnit[],
  history: AssignmentHistorySummary[],
  nowMilliseconds = Date.now(),
): StudentProgressSummary[] {
  const latestOverallByStudent = new Map<
    string,
    AssignmentHistorySummary
  >();
  const latestCurrentDatasetByStudent = new Map<
    string,
    AssignmentHistorySummary
  >();
  const latestCompletedByStudent = new Map<
    string,
    AssignmentHistorySummary
  >();
  const nextAssignmentBasisByStudent = new Map<
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
    if (item.assignmentDeleted) {
      continue;
    }
    const currentLatest = latestOverallByStudent.get(item.studentId);
    if (
      !currentLatest ||
      activityTime(item) > activityTime(currentLatest)
    ) {
      latestOverallByStudent.set(item.studentId, item);
    }
    if (item.status === "completed") {
      const latestCompleted = latestCompletedByStudent.get(
        item.studentId,
      );
      if (
        !latestCompleted ||
        activityTime(item) > activityTime(latestCompleted)
      ) {
        latestCompletedByStudent.set(item.studentId, item);
      }
    }

    const student = studentById.get(item.studentId);
    if (
      student?.currentVocabDatasetId === item.datasetId &&
      item.assignmentPurpose !== "review" &&
      item.status !== "cancelled"
    ) {
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

      const currentBasis = nextAssignmentBasisByStudent.get(item.studentId);
      if (!currentBasis || isLaterAssignment(item, currentBasis)) {
        nextAssignmentBasisByStudent.set(item.studentId, item);
      }
    }
  }

  return students.map((student) => {
    const latest = latestOverallByStudent.get(student.id) ?? null;
    const latestCompleted =
      latestCompletedByStudent.get(student.id) ?? null;
    const latestCurrent =
      latestCurrentDatasetByStudent.get(student.id) ?? null;
    const nextAssignmentBasis =
      nextAssignmentBasisByStudent.get(student.id) ?? null;
    const datasetUnits = student.currentVocabDatasetId
      ? (unitsByDataset.get(student.currentVocabDatasetId) ?? [])
      : [];

    let recommendedUnits: ProgressUnit[] = datasetUnits[0]
      ? [datasetUnits[0]]
      : [];
    let recommendedDirection: 1 | -1 = 1;
    let recommendedRangeTruncated = false;
    let recommendationReason:
      | StudentProgressSummary["recommendationReason"] =
      recommendedUnits.length > 0 ? "first" : null;

    if (latestCurrent && datasetUnits.length > 0) {
      if (latestCurrent.primaryUnitIds.length === 0) {
        recommendedUnits = [];
        recommendationReason = "manual";
      } else {
        let previousUnits: ProgressUnit[] = [];
        try {
          previousUnits = resolveOrderedContiguousUnits(
            datasetUnits,
            latestCurrent.primaryUnitIds,
          );
        } catch {
          recommendedUnits = [];
          recommendationReason = "manual";
        }

        if (previousUnits.length > 0) {
          recommendedDirection =
            previousUnits.length > 1 &&
            previousUnits[1].sortIndex < previousUnits[0].sortIndex
              ? -1
              : 1;

          if (latestCurrent.status === "not_started") {
            recommendedUnits = previousUnits;
            recommendationReason = "assigned";
          } else if (latestCurrent.status === "in_progress") {
            recommendedUnits = previousUnits;
            recommendationReason = "resume";
          } else if (
            latestCurrent.status === "completed" &&
            latestCurrent.passed === true
          ) {
            const nextRange = planNextUnitRange(
              datasetUnits,
              latestCurrent.primaryUnitIds,
            );
            recommendedUnits = nextRange?.units ?? [];
            recommendedDirection = nextRange?.direction ?? recommendedDirection;
            recommendedRangeTruncated = nextRange?.truncated ?? false;
            recommendationReason =
              recommendedUnits.length > 0 ? "next" : "complete";
          } else {
            recommendedUnits = previousUnits;
            recommendationReason = "repeat";
          }
        }
      }
    }

    const recommendedUnitLabel =
      recommendedUnits.length === 0
        ? null
        : recommendedUnits.length === 1
          ? recommendedUnits[0].label
          : `${recommendedUnits[0].label}~${recommendedUnits.at(-1)!.label}`;
    let nextAssignmentUnits: ProgressUnit[] = datasetUnits[0]
      ? [datasetUnits[0]]
      : [];
    if (nextAssignmentBasis && datasetUnits.length > 0) {
      try {
        const basisUnits = resolveOrderedContiguousUnits(
          datasetUnits,
          nextAssignmentBasis.primaryUnitIds,
        );
        const shouldRepeat =
          nextAssignmentBasis.status === "missed" ||
          nextAssignmentBasis.status === "expired" ||
          (nextAssignmentBasis.status === "completed" &&
            nextAssignmentBasis.passed !== true);
        nextAssignmentUnits = shouldRepeat
          ? basisUnits
          : (planNextUnitRange(
              datasetUnits,
              nextAssignmentBasis.primaryUnitIds,
            )?.units ?? []);
      } catch {
        nextAssignmentUnits = [];
      }
    }
    const nextAssignmentDefaults =
      student.currentVocabDatasetId && nextAssignmentUnits.length > 0
        ? {
            availableUntil: nextAssignmentBasis
              ? rollAssignmentDeadlineForward(
                  nextAssignmentBasis.assignedAt,
                  nextAssignmentBasis.availableUntil,
                  nowMilliseconds,
                  nextAssignmentBasis.availableFrom,
                )
              : null,
            basisAssignmentId: nextAssignmentBasis?.assignmentId ?? null,
            datasetId: student.currentVocabDatasetId,
            englishToKoreanRatio:
              nextAssignmentBasis?.englishToKoreanRatio ?? 50,
            passingScore: nextAssignmentBasis?.passingScore ?? 80,
            questionOrderMode:
              nextAssignmentBasis?.questionOrderMode === "fixed"
                ? "ascending"
                : (nextAssignmentBasis?.questionOrderMode ?? "random"),
            questionTimeLimitSeconds:
              nextAssignmentBasis?.questionTimeLimitSeconds ?? null,
            timeLimitSeconds: nextAssignmentBasis?.timeLimitSeconds ?? 300,
            timingMode: nextAssignmentBasis?.timingMode ?? "total",
            unitIds: nextAssignmentUnits.map((unit) => unit.id),
          }
        : null;
    const nextAssignmentBlockedReason =
      nextAssignmentBasis?.availableFrom &&
      Date.parse(nextAssignmentBasis.availableFrom) > nowMilliseconds
        ? "scheduled"
        : null;

    return {
      studentId: student.id,
      latestAttemptId: latest?.attemptId ?? null,
      latestAssignmentTitle: latest?.assignmentTitle ?? null,
      latestStatus: latest?.status ?? null,
      latestPhase: latest?.phase ?? null,
      latestScore:
        latest?.finalScore ?? latest?.initialScore ?? null,
      latestInitialScore: latest?.initialScore ?? null,
      latestFinalScore: latest?.finalScore ?? null,
      latestPassingScore: latest?.passingScore ?? null,
      latestRetryStartedAt: latest?.retryStartedAt ?? null,
      latestPassed: latest?.passed ?? null,
      latestUnitLabel: latest ? assignmentScopeLabel(latest) : null,
      latestAttemptNumber: latest?.attemptNumber ?? null,
      latestStartedAt: latest?.startedAt ?? null,
      latestCompletedAt: latest?.completedAt ?? null,
      latestCompletedAssignmentTitle:
        latestCompleted?.assignmentTitle ?? null,
      latestCompletedInitialScore:
        latestCompleted?.initialScore ?? null,
      latestCompletedFinalScore:
        latestCompleted?.finalScore ?? null,
      recommendedDatasetId: student.currentVocabDatasetId,
      recommendedUnitId: recommendedUnits[0]?.id ?? null,
      recommendedUnitLabel,
      recommendedUnitIds: recommendedUnits.map((unit) => unit.id),
      recommendedUnitLabels: recommendedUnits.map((unit) => unit.label),
      recommendedDirection,
      recommendedRangeTruncated,
      nextAssignmentBlockedReason,
      nextAssignmentDefaults,
      recommendationReason,
    };
  });
}
