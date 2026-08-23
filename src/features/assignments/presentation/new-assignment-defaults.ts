import { isoToKoreanDateTimeLocal } from "@/lib/deadline";
import { newAssignmentDefaultUnitIds } from "@/lib/admin/new-assignment-range";

import type { AssignmentProgressItem } from "../catalog-types";
import type { AssignmentDeadline, ExamSettings } from "../domain/model";

export type NewAssignmentDraftDefaults = {
  deadline: AssignmentDeadline;
  exam: ExamSettings;
  orderedUnitIds: string[];
};

const defaultExam: ExamSettings = {
  directionRatio: 50,
  passingScore: 80,
  retryEnabled: true,
  retryPassingScore: 80,
  questionOrderMode: "random",
  timeLimitEnabled: true,
  timing: { mode: "total", totalSeconds: 300 },
};

function inheritedExam(
  source: NonNullable<AssignmentProgressItem["nextAssignmentDefaults"]>,
): ExamSettings {
  const directionRatio = [0, 50, 100].includes(source.englishToKoreanRatio)
    ? (source.englishToKoreanRatio as 0 | 50 | 100)
    : defaultExam.directionRatio;
  const passingScore =
    Number.isInteger(source.passingScore) &&
    source.passingScore >= 0 &&
    source.passingScore <= 100
      ? source.passingScore
      : defaultExam.passingScore;
  const questionOrderMode = ["ascending", "descending", "random"].includes(
    source.questionOrderMode,
  )
    ? source.questionOrderMode
    : defaultExam.questionOrderMode;
  const timing =
    source.timingMode === "per_question" &&
    Number.isInteger(source.questionTimeLimitSeconds) &&
    source.questionTimeLimitSeconds !== null &&
    source.questionTimeLimitSeconds >= 5 &&
    source.questionTimeLimitSeconds <= 600
      ? {
          mode: "per_question" as const,
          perQuestionSeconds: source.questionTimeLimitSeconds,
        }
      : source.timingMode === "total" &&
          Number.isInteger(source.timeLimitSeconds) &&
          source.timeLimitSeconds >= 30 &&
          source.timeLimitSeconds <= 10_800
        ? {
            mode: "total" as const,
            totalSeconds: source.timeLimitSeconds,
          }
        : defaultExam.timing;
  return {
    directionRatio,
    passingScore,
    retryEnabled: true,
    retryPassingScore: passingScore,
    questionOrderMode,
    timeLimitEnabled: source.timingMode !== "none",
    timing,
  };
}

export function newAssignmentDraftDefaults(
  progress: AssignmentProgressItem | null,
  datasetId: string,
  fallbackUnitId = "",
): NewAssignmentDraftDefaults {
  const source =
    progress?.nextAssignmentDefaults?.datasetId === datasetId
      ? progress.nextAssignmentDefaults
      : null;
  const deadlineLocal = isoToKoreanDateTimeLocal(
    source?.availableUntil ?? null,
  );
  const recommendedUnitIds = newAssignmentDefaultUnitIds(progress, datasetId);
  const orderedUnitIds =
    recommendedUnitIds.length > 0
      ? recommendedUnitIds
      : (!progress || progress.recommendedDatasetId !== datasetId) &&
          fallbackUnitId
        ? [fallbackUnitId]
        : [];
  return {
    deadline: deadlineLocal
      ? { mode: "at", koreanLocalDateTime: deadlineLocal }
      : { mode: "none" },
    exam: source ? inheritedExam(source) : defaultExam,
    orderedUnitIds,
  };
}
