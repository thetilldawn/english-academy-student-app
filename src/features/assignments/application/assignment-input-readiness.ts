import type { BulkSeriesAssignmentDraft, DirectReviewAssignmentDraft, SingleAssignmentDraft } from "../domain/model";
import { incompleteAssignmentNumberIssues } from "../domain/validation";

/** Controllers receive readiness, while numeric rules remain owned by the domain. */
export function assignmentNumbersComplete(
  draft: SingleAssignmentDraft | BulkSeriesAssignmentDraft | DirectReviewAssignmentDraft,
) {
  return incompleteAssignmentNumberIssues(draft).length === 0;
}
