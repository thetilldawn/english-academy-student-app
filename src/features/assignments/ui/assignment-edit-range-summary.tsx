import type { AssignmentEditDraft } from "@/lib/admin/assignment-edit";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";

import type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "../catalog-types";
import styles from "./single-assignment-editor.module.css";

function reviewLevelLabel(levels: readonly (1 | 2)[]) {
  return levels
    .map((level) => level === 1 ? "1회" : "2회 이상")
    .join(" · ") || "기존 오답 기준";
}

export function AssignmentEditRangeSummary({
  datasets,
  source,
  units,
}: {
  datasets: readonly AssignmentDatasetItem[];
  source: AssignmentEditDraft;
  units: readonly AssignmentUnitItem[];
}) {
  const dataset = datasets.find((item) => item.id === source.datasetId);
  const selectedUnitIds = new Set(source.primaryUnitIds);
  const rangeLabel = units
    .filter(
      (unit) =>
        unit.datasetId === source.datasetId && selectedUnitIds.has(unit.id),
    )
    .toSorted((left, right) => left.sortIndex - right.sortIndex)
    .map((unit) => unit.displayName || unit.label)
    .join(" · ");
  const purposeLabel = source.purpose === "review"
    ? "오답 시험"
    : "단어+오답 시험";
  const scopeLabel = source.reviewScope === "selection"
    ? "선택 범위 오답"
    : "단어장 전체 오답";

  return (
    <dl className={styles.summaryFacts}>
      <div><dt>시험 종류</dt><dd>{purposeLabel}</dd></div>
      <div>
        <dt>단어장</dt>
        <dd>{dataset ? cataloguedDatasetDisplayLabel(dataset) : source.datasetId}</dd>
      </div>
      <div><dt>범위</dt><dd>{rangeLabel || scopeLabel}</dd></div>
      <div><dt>틀린 횟수</dt><dd>{reviewLevelLabel(source.reviewLevels)}</dd></div>
      <div><dt>단어 수</dt><dd>{source.questionCount}개</dd></div>
      <div><dt>오답 범위</dt><dd>{scopeLabel}</dd></div>
    </dl>
  );
}
