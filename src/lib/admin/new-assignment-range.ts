export type AssignmentRangeRecommendation = {
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendationReason:
    | "assigned"
    | "first"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
    | "manual"
    | null;
};

export function needsExplicitNewAssignmentRange(
  progress: AssignmentRangeRecommendation | null,
  datasetId: string,
) {
  return Boolean(
    progress &&
      progress.recommendedDatasetId === datasetId &&
      (progress.recommendationReason === "assigned" ||
        progress.recommendationReason === "resume" ||
        progress.recommendationReason === "manual"),
  );
}

export function newAssignmentDefaultUnitId(
  progress: AssignmentRangeRecommendation | null,
  datasetId: string,
) {
  if (
    !progress ||
    progress.recommendedDatasetId !== datasetId ||
    needsExplicitNewAssignmentRange(progress, datasetId)
  ) {
    return "";
  }
  return progress.recommendedUnitId ?? "";
}
