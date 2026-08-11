import { adminLearningText } from "@/content/ko/admin-learning";

import type { SingleAssignmentSubmitBlocker } from "../domain/submit-blocker";

function validationReason(path: string) {
  const reasons = adminLearningText.assignmentModal.submit.blockedReason.validation;
  if (path === "studentId") return reasons.student;
  if (path === "range.datasetId") return reasons.dataset;
  if (path.startsWith("range.orderedUnitIds")) return reasons.range;
  if (path.startsWith("review")) return reasons.review;
  if (path === "exam.directionRatio") return reasons.direction;
  if (path === "exam.questionOrderMode") return reasons.order;
  if (path === "exam.passingScore") return reasons.score;
  if (path.startsWith("exam.timing")) return reasons.timing;
  if (path.startsWith("deadline")) return reasons.deadline;
  if (path === "questionCount") return reasons.questionCount;
  if (path === "title") return reasons.title;
  return reasons.fallback;
}

export function assignmentSubmitBlockerLabel(
  blocker: SingleAssignmentSubmitBlocker | null,
) {
  if (!blocker) return null;
  const labels = adminLearningText.assignmentModal.submit.blockedReason;
  switch (blocker.code) {
    case "loading":
      return labels.loading;
    case "load_failed":
      return labels.loadFailed;
    case "invalid":
      return validationReason(blocker.path);
    case "unchanged":
      return labels.unchanged;
    case "capacity_loading":
      return labels.capacityLoading;
    case "capacity_failed":
      return labels.capacityFailed;
    case "range_unavailable":
      return labels.rangeUnavailable;
    case "question_count_too_low":
      return labels.questionCountTooLow;
    case "question_count_too_high":
      return labels.questionCountTooHigh;
    case "no_review_words":
      return labels.noReviewWords;
    case "processing":
      return labels.processing;
  }
}

export function assignmentSubmitButtonLabel({
  busy,
  dirty,
  editing,
  reviewMode,
}: {
  busy: boolean;
  dirty: boolean;
  editing: boolean;
  reviewMode: "none" | "pending";
}) {
  const labels = adminLearningText.assignmentModal.submit;
  if (busy) return editing ? labels.saving : labels.assigning;
  if (editing) return dirty ? labels.saveChanges : labels.noChanges;
  return reviewMode === "pending" ? labels.assignWithWrong : labels.assign;
}
