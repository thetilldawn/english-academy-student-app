import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type {
  ReviewLevel,
  SingleAssignmentDraft,
  SingleAssignmentOperation,
} from "../domain/model";
import { normalizeLegacyQuestionOrderMode } from "../domain/model";
import { assertValidSingleCapacityProjection } from "../domain/validation";
import {
  parseAssignmentEditDraftResponse,
  type AssignmentEditDraftResponse,
} from "./response-adapters";

const DEFAULT_REVIEW_LEVELS = [1, 2] as const;

function replacementOperation(
  source: AssignmentEditDraftResponse,
): SingleAssignmentOperation {
  const common = {
    mode: "replace" as const,
    assignmentId: source.assignmentId,
    targetStudentId: source.studentId,
  };
  if (source.purpose !== "review") {
    return { ...common, sourcePurpose: source.purpose };
  }
  return {
    ...common,
    sourcePurpose: "review",
    lockedShape: {
      datasetId: source.datasetId,
      orderedUnitIds: [...source.primaryUnitIds],
      questionCount: source.questionCount,
      reviewLevels: [...source.reviewLevels],
    },
  };
}

function retainedReviewLevels(
  source: AssignmentEditDraftResponse,
): readonly ReviewLevel[] {
  return source.reviewLevels.length > 0
    ? source.reviewLevels
    : DEFAULT_REVIEW_LEVELS;
}

export function hydrateSingleAssignmentDraftFromEditResponse(
  value: unknown,
): SingleAssignmentDraft {
  const source = parseAssignmentEditDraftResponse(value);
  const levels = retainedReviewLevels(source);
  const deadlineLocal = isoToKoreanDateTimeLocal(source.availableUntil);
  const draft: SingleAssignmentDraft = {
    kind: "single",
    operation: replacementOperation(source),
    studentId: source.studentId,
    title: { mode: "source", value: source.title },
    range: {
      datasetId: source.datasetId,
      orderedUnitIds: [...source.primaryUnitIds],
    },
    questionCount: { mode: "manual", value: source.questionCount },
    exam: {
      directionRatio: source.englishToKoreanRatio,
      questionOrderMode: normalizeLegacyQuestionOrderMode(
        source.questionOrderMode,
      ),
      passingScore: source.passingScore,
      timing:
        source.timingMode === "total"
          ? { mode: "total", totalSeconds: source.timeLimitSeconds }
          : {
              mode: "per_question",
              perQuestionSeconds: source.questionTimeLimitSeconds!,
            },
    },
    deadline:
      source.availableUntil === null
        ? { mode: "none" }
        : { mode: "at", koreanLocalDateTime: deadlineLocal },
    review: source.includePendingReview
      ? { mode: "pending", scope: "dataset", levels }
      : { mode: "none", scope: "dataset", levels },
  };

  assertValidSingleCapacityProjection(draft);
  return draft;
}
