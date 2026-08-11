import type { AssignmentDraftIssue } from "./validation";

export type SingleAssignmentSubmitBlocker =
  | { code: "loading" }
  | { code: "load_failed" }
  | { code: "invalid"; path: string }
  | { code: "unchanged" }
  | { code: "capacity_loading" }
  | { code: "capacity_failed" }
  | { code: "range_unavailable" }
  | { code: "question_count_too_low" }
  | { code: "question_count_too_high" }
  | { code: "no_review_words" }
  | { code: "processing" };

type SubmitCapacity = {
  maximumQuestionCount: number;
  minimumQuestionCount: number;
  wrongEligible: number;
};

export function deriveSingleAssignmentSubmitBlocker({
  capacity,
  capacityReadyForCurrentDraft,
  dirty,
  issues,
  loadStatus,
  minimumQuestionCount,
  previewStatus,
  questionCount,
  reviewMode,
  submissionStatus,
}: {
  capacity: SubmitCapacity | null;
  capacityReadyForCurrentDraft: boolean;
  dirty: boolean;
  issues: readonly AssignmentDraftIssue[];
  loadStatus: "loading" | "ready" | "error";
  minimumQuestionCount: number;
  previewStatus: "idle" | "loading" | "ready" | "error";
  questionCount: number;
  reviewMode: "none" | "pending";
  submissionStatus: "idle" | "submitting" | "succeeded" | "conflict" | "failed";
}): SingleAssignmentSubmitBlocker | null {
  if (submissionStatus !== "idle") return { code: "processing" };
  if (loadStatus === "loading") return { code: "loading" };
  if (loadStatus === "error") return { code: "load_failed" };

  const firstIssue = issues[0];
  if (firstIssue) return { code: "invalid", path: firstIssue.path };
  if (!dirty) return { code: "unchanged" };
  if (previewStatus === "error") return { code: "capacity_failed" };
  if (
    previewStatus !== "ready" ||
    !capacityReadyForCurrentDraft ||
    capacity === null
  ) {
    return { code: "capacity_loading" };
  }
  if (capacity.maximumQuestionCount < minimumQuestionCount) {
    return { code: "range_unavailable" };
  }
  if (reviewMode === "pending" && capacity.wrongEligible < 1) {
    return { code: "no_review_words" };
  }
  if (questionCount < capacity.minimumQuestionCount) {
    return { code: "question_count_too_low" };
  }
  if (questionCount > capacity.maximumQuestionCount) {
    return { code: "question_count_too_high" };
  }
  return null;
}
