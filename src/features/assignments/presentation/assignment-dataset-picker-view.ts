import { cataloguedDatasetDisplayLabel, compareCataloguedDatasets } from "@/lib/admin/dataset-catalog";
import type { AssignmentDatasetItem } from "../catalog-types";
import {
  type DatasetPickerFilters,
  type DatasetPickerKind,
  type DatasetPickerStage,
} from "../domain/assignment-dataset-picker";

export type DatasetPickerOption = {
  dataset: AssignmentDatasetItem;
  reviewCount?: number;
};

export function datasetPickerStage(dataset: AssignmentDatasetItem): Exclude<DatasetPickerStage, "all"> {
  // Missing catalog metadata currently falls back to catalogGroup=high.
  // Do not turn that transport fallback (or a title) into a confirmed stage.
  if (!dataset.materialKind) return "unclassified";
  return dataset.catalogGroup === "middle" ? "middle" : "high";
}

export function datasetPickerKind(dataset: AssignmentDatasetItem): Exclude<DatasetPickerKind, "all"> {
  return dataset.materialKind ?? "unclassified";
}

export function datasetPickerGrade(dataset: AssignmentDatasetItem): string | null {
  const aliases: Record<string, string> = {
    m1: "g7", m2: "g8", m3: "g9", h1: "g10", h2: "g11", h3: "g12",
    g7: "g7", g8: "g8", g9: "g9", g10: "g10", g11: "g11", g12: "g12",
  };
  return aliases[dataset.gradeCode?.trim().toLowerCase() ?? ""] ?? null;
}

function searchable(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

export function filterDatasetPickerOptions(
  options: readonly DatasetPickerOption[],
  filters: DatasetPickerFilters,
): DatasetPickerOption[] {
  const terms = searchable(filters.query).split(" ").filter(Boolean);
  return options.filter(({ dataset }) => {
    if (filters.stage !== "all" && datasetPickerStage(dataset) !== filters.stage) return false;
    if (filters.kind !== "all" && datasetPickerKind(dataset) !== filters.kind) return false;
    if (filters.grade !== "all" && datasetPickerGrade(dataset) !== filters.grade) return false;
    const text = searchable([
      cataloguedDatasetDisplayLabel(dataset), dataset.title, dataset.edition,
      dataset.publisher, dataset.seriesTitle, dataset.academicYear,
      dataset.curriculumRevision, dataset.editionLabel, dataset.gradeCode,
    ].filter((part) => part !== null && part !== undefined).join(" "));
    return terms.every((term) => text.includes(term));
  }).toSorted((left, right) => compareCataloguedDatasets(left.dataset, right.dataset));
}

const stageLabels: Record<DatasetPickerStage, string> = {
  all: "전체", middle: "중등", high: "고등", unclassified: "미분류",
};
const kindLabels: Record<DatasetPickerKind, string> = {
  all: "전체", wordbook: "단어장", textbook: "교과서",
  exam_collection: "모의고사·문제집", exam_prep: "시험 대비",
  supplement: "보충 자료", unclassified: "미분류",
};
const gradeLabels: Record<string, string> = {
  g7: "중1", g8: "중2", g9: "중3", g10: "고1", g11: "고2", g12: "고3",
};

export type DatasetFilterButton<Value extends string = string> = {
  value: Value; label: string; count: number;
};

export function datasetPickerMetadata(dataset: AssignmentDatasetItem) {
  return [
    stageLabels[datasetPickerStage(dataset)],
    dataset.materialKind ? kindLabels[dataset.materialKind] : null,
    gradeLabels[datasetPickerGrade(dataset) ?? ""],
    dataset.catalogGroup === "csat" ? "수능" : null,
    dataset.publisher,
  ].filter(Boolean).join(" · ");
}

export function datasetPickerFilterButtons(
  options: readonly DatasetPickerOption[],
  filters: DatasetPickerFilters,
) {
  const stageValues = new Set(options.map(({ dataset }) => datasetPickerStage(dataset)));
  const kindValues = new Set(options.map(({ dataset }) => datasetPickerKind(dataset)));
  const stage = (Object.keys(stageLabels) as DatasetPickerStage[])
    .filter((value) => value === "all" || stageValues.has(value) || filters.stage === value)
    .map((value) => ({
      value, label: stageLabels[value],
      count: filterDatasetPickerOptions(options, { ...filters, stage: value, grade: "all" }).length,
    }));
  const kind = (Object.keys(kindLabels) as DatasetPickerKind[])
    .filter((value) => value === "all" || kindValues.has(value) || filters.kind === value)
    .map((value) => ({
      value, label: kindLabels[value],
      count: filterDatasetPickerOptions(options, { ...filters, kind: value }).length,
    }));
  const gradeOptions = options.filter(({ dataset }) =>
    filters.stage === "all" || datasetPickerStage(dataset) === filters.stage,
  );
  const grades = [...new Set(gradeOptions.flatMap(({ dataset }) =>
    datasetPickerGrade(dataset) ? [datasetPickerGrade(dataset)!] : [],
  ))].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  const grade = ["all", ...grades].map((value) => ({
    value, label: value === "all" ? "전체" : gradeLabels[value] ?? value,
    count: filterDatasetPickerOptions(options, { ...filters, grade: value }).length,
  }));
  return { stage, kind, grade };
}
