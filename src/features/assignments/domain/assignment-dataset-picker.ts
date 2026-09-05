export type DatasetPickerStage = "all" | "middle" | "high" | "unclassified";
export type DatasetPickerKind =
  | "all" | "textbook" | "wordbook" | "exam_collection"
  | "exam_prep" | "supplement" | "unclassified";
export type DatasetPickerFilters = {
  query: string;
  stage: DatasetPickerStage;
  kind: DatasetPickerKind;
  grade: string;
};

export const EMPTY_DATASET_FILTERS: DatasetPickerFilters = {
  query: "", stage: "all", kind: "all", grade: "all",
};
export const RECENT_DATASET_LIMIT = 6;

export function sanitizeRecentDatasetIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string =>
    typeof id === "string" && id.length > 0 && id.length <= 128 && !/\s/u.test(id),
  ))].slice(0, RECENT_DATASET_LIMIT);
}

export function rememberDatasetSelection(ids: readonly string[], datasetId: string) {
  return sanitizeRecentDatasetIds([datasetId, ...ids]);
}

export function splitRecentDatasetOptions<Option extends { dataset: { id: string } }>(
  filtered: readonly Option[],
  recentIds: readonly string[],
) {
  const byId = new Map(filtered.map((option) => [option.dataset.id, option]));
  const recent = sanitizeRecentDatasetIds(recentIds).flatMap((id) => {
    const option = byId.get(id);
    return option ? [option] : [];
  });
  const shownIds = new Set(recent.map((option) => option.dataset.id));
  return { recent, remaining: filtered.filter((option) => !shownIds.has(option.dataset.id)) };
}
