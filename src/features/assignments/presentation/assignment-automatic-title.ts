import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";

import type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { SingleAssignmentDraft } from "../domain/model";
import { assignmentUnitRangeLabel } from "./assignment-unit-range-label";

export function buildAutomaticAssignmentTitle(
  draft: SingleAssignmentDraft,
  capacity: { wrongEligible: number } | null,
  datasets: readonly AssignmentDatasetItem[],
  units: readonly AssignmentUnitItem[],
) {
  const dataset = datasets.find(
    (candidate) => candidate.id === draft.range.datasetId,
  );
  const labels = draft.range.orderedUnitIds.map(
    (unitId) =>
      units.find((unit) => unit.id === unitId)?.displayName ??
      adminLearningText.assignmentModal.range.unknownUnit,
  );

  return [
    dataset ? cataloguedDatasetDisplayLabel(dataset) : null,
    assignmentUnitRangeLabel(labels),
    draft.review.mode === "pending"
      ? formatContentText(
          adminLearningText.assignmentModal.overview.includedWrong,
          { count: capacity?.wrongEligible ?? 0 },
        )
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
