import type { SingleAssignmentSubmitBlocker } from "../domain/submit-blocker";

const correctableBlockers = new Set<SingleAssignmentSubmitBlocker["code"]>([
  "invalid",
  "range_unavailable",
  "question_count_too_low",
  "question_count_too_high",
  "no_review_words",
]);

export function assignmentEditSubmitPresentation({
  canSubmit,
  blocker,
  submitAttempted,
}: {
  canSubmit: boolean;
  blocker: SingleAssignmentSubmitBlocker | null;
  submitAttempted: boolean;
}) {
  const correctable = blocker ? correctableBlockers.has(blocker.code) : false;
  return {
    canSubmit: canSubmit || (!submitAttempted && correctable),
    showBlockedReason: !correctable || submitAttempted,
  };
}
