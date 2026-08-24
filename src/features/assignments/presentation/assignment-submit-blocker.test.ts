import { describe, expect, it } from "vitest";

import { adminLearningText } from "@/content/ko/admin-learning";

import type { SingleAssignmentSubmitBlocker } from "../domain/submit-blocker";
import {
  assignmentSubmitBlockerLabel,
  assignmentSubmitButtonLabel,
} from "./assignment-submit-blocker";

const blockers: readonly SingleAssignmentSubmitBlocker[] = [
  { code: "loading" },
  { code: "load_failed" },
  { code: "unchanged" },
  { code: "capacity_loading" },
  { code: "capacity_failed" },
  { code: "range_unavailable" },
  { code: "question_count_too_low" },
  { code: "question_count_too_high" },
  { code: "no_review_words" },
  { code: "processing" },
  { code: "invalid", path: "studentId" },
  { code: "invalid", path: "range.datasetId" },
  { code: "invalid", path: "range.orderedUnitIds" },
  { code: "invalid", path: "review.levels" },
  { code: "invalid", path: "exam.directionRatio" },
  { code: "invalid", path: "exam.questionOrderMode" },
  { code: "invalid", path: "exam.passingScore" },
  { code: "invalid", path: "exam.timing" },
  { code: "invalid", path: "exam.timing.totalSeconds" },
  { code: "invalid", path: "exam.timing.perQuestionSeconds" },
  { code: "invalid", path: "deadline" },
  { code: "invalid", path: "questionCount" },
  { code: "invalid", path: "title" },
  { code: "invalid", path: "unknown" },
];

describe("assignment submit blocker labels", () => {
  it("keeps every disabled reason concise and visible beside the button", () => {
    for (const blocker of blockers) {
      const label = assignmentSubmitBlockerLabel(blocker);
      expect(label).toBeTruthy();
      expect(label!.length).toBeLessThanOrEqual(10);
    }
    expect(
      adminLearningText.assignmentModal.submit.blockedReason.noReadyDataset
        .length,
    ).toBeLessThanOrEqual(10);
    expect(
      adminLearningText.assignmentModal.submit.blockedReason
        .scheduledAssignment.length,
    ).toBeLessThanOrEqual(10);
  });

  it("does not render a reason when submission is enabled", () => {
    expect(assignmentSubmitBlockerLabel(null)).toBeNull();
  });

  it("uses the same button copy for footer and top-header submission", () => {
    expect(
      assignmentSubmitButtonLabel({
        busy: false,
        dirty: true,
        editing: true,
        reviewMode: "none",
      }),
    ).toBe("변경 저장");
    expect(
      assignmentSubmitButtonLabel({
        busy: false,
        dirty: true,
        editing: false,
        reviewMode: "pending",
      }),
    ).toBe("틀렸던 단어 포함해 배정");
  });
});
