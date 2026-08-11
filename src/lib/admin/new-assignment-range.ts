export type AssignmentRangeRecommendation = {
  recommendedDatasetId: string | null;
  recommendedUnitId: string | null;
  recommendedUnitIds?: readonly string[];
  nextAssignmentDefaults?: {
    datasetId: string;
    unitIds: readonly string[];
  } | null;
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
      !(
        progress.nextAssignmentDefaults?.datasetId === datasetId &&
        progress.nextAssignmentDefaults.unitIds.length > 0
      ) &&
      (progress.recommendationReason === "assigned" ||
        progress.recommendationReason === "resume" ||
        progress.recommendationReason === "manual"),
  );
}

export function newAssignmentDefaultUnitIds(
  progress: AssignmentRangeRecommendation | null,
  datasetId: string,
) {
  if (
    progress?.nextAssignmentDefaults?.datasetId === datasetId &&
    progress.nextAssignmentDefaults.unitIds.length > 0
  ) {
    return [...progress.nextAssignmentDefaults.unitIds];
  }
  if (
    !progress ||
    progress.recommendedDatasetId !== datasetId ||
    needsExplicitNewAssignmentRange(progress, datasetId)
  ) {
    return [];
  }
  if (progress.recommendedUnitIds?.length) {
    return [...progress.recommendedUnitIds];
  }
  return progress.recommendedUnitId ? [progress.recommendedUnitId] : [];
}

export function newAssignmentDefaultUnitId(
  progress: AssignmentRangeRecommendation | null,
  datasetId: string,
) {
  return newAssignmentDefaultUnitIds(progress, datasetId)[0] ?? "";
}
