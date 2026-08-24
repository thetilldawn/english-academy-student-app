import type { AssignmentReplacementInput } from "@/lib/admin/assignment-edit";
import {
  AssignmentReplacementError,
} from "@/lib/services/assignment-replacement-errors";
import type {
  EditableSourceContext,
} from "@/lib/services/assignment-edit-source-service";

function sameOrderedValues(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function canReuseSourceQuestions(
  source: EditableSourceContext,
  input: AssignmentReplacementInput,
) {
  const before = source.draft;
  return (
    source.questions !== null &&
    before.datasetId === input.datasetId &&
    sameOrderedValues(before.primaryUnitIds, input.primaryUnitIds) &&
    before.questionCount === input.questionCount &&
    before.englishToKoreanRatio === input.englishToKoreanRatio &&
    before.includePendingReview === input.includePendingReview &&
    (!before.includePendingReview ||
      sameOrderedValues(
        [...before.reviewLevels].toSorted(),
        [...input.reviewLevels].toSorted(),
      ))
  );
}

export function assertExactReviewShape(
  source: EditableSourceContext,
  input: Pick<
    AssignmentReplacementInput,
    | "datasetId"
    | "primaryUnitIds"
    | "questionCount"
    | "includePendingReview"
    | "reviewLevels"
  >,
) {
  const before = source.draft;
  if (
    !input.includePendingReview ||
    input.datasetId !== before.datasetId ||
    !sameOrderedValues(input.primaryUnitIds, before.primaryUnitIds) ||
    input.questionCount !== source.selectedQueueIds.length ||
    !sameOrderedValues(
      [...input.reviewLevels].toSorted(),
      [...before.reviewLevels].toSorted(),
    )
  ) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      "오답 시험은 대상 단어를 유지한 채 제목·출제 방향·순서·시간·통과 점수·마감만 수정할 수 있습니다.",
    );
  }
}

