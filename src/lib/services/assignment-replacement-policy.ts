import type { AssignmentReplacementInput } from "@/lib/admin/assignment-edit";
import {
  lockedAssignmentEditChangeKeys,
  type AssignmentEditComparable,
} from "@/lib/admin/assignment-edit-policy";
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

type AssignmentEditPolicyInput = Pick<
  AssignmentReplacementInput,
  | "datasetId"
  | "primaryUnitIds"
  | "includePendingReview"
  | "reviewLevels"
> &
  Partial<
    Pick<
      AssignmentReplacementInput,
      | "title"
      | "questionCount"
      | "englishToKoreanRatio"
      | "timeLimitSeconds"
      | "timingMode"
      | "questionTimeLimitSeconds"
      | "passingScore"
      | "retryEnabled"
      | "retryPassingScore"
      | "questionOrderMode"
      | "availableFrom"
      | "availableUntil"
      | "reviewScope"
    >
  >;

function comparableAfter(
  before: AssignmentEditComparable,
  input: AssignmentEditPolicyInput,
): AssignmentEditComparable {
  return {
    ...before,
    ...input,
    title: input.title ?? before.title,
    questionCount: input.questionCount ?? before.questionCount,
    englishToKoreanRatio:
      input.englishToKoreanRatio ?? before.englishToKoreanRatio,
    timeLimitSeconds:
      input.timeLimitSeconds ?? before.timeLimitSeconds,
    timingMode: input.timingMode ?? before.timingMode,
    questionTimeLimitSeconds:
      input.questionTimeLimitSeconds === undefined
        ? before.questionTimeLimitSeconds
        : input.questionTimeLimitSeconds,
    passingScore: input.passingScore ?? before.passingScore,
    retryEnabled: input.retryEnabled ?? before.retryEnabled,
    retryPassingScore:
      input.retryPassingScore === undefined
        ? before.retryPassingScore
        : input.retryPassingScore,
    questionOrderMode:
      input.questionOrderMode ?? before.questionOrderMode,
    availableFrom:
      input.availableFrom === undefined
        ? before.availableFrom
        : input.availableFrom,
    availableUntil:
      input.availableUntil === undefined
        ? before.availableUntil
        : input.availableUntil,
    reviewScope: input.reviewScope ?? before.reviewScope,
  };
}

export function assertAssignmentEditFieldPolicy(
  source: EditableSourceContext,
  input: AssignmentEditPolicyInput,
) {
  const locked = lockedAssignmentEditChangeKeys(
    source.draft.purpose,
    source.draft,
    comparableAfter(source.draft, input),
    { seriesItem: source.draft.seriesItem },
  );
  if (locked.length > 0) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      `수정할 수 없는 항목이 변경되었습니다: ${locked.join(", ")}`,
    );
  }
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
      before.reviewScope === input.reviewScope) &&
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
    | "reviewScope"
  >,
) {
  const before = source.draft;
  assertAssignmentEditFieldPolicy(source, input);
  if (
    source.questions === null ||
    source.selectedQueueIds.length !== before.questionCount
  ) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      "오답 시험은 대상 단어를 유지한 채 제목·출제 방향·순서·시간·통과 점수·마감만 수정할 수 있습니다.",
    );
  }
}

export function assertLegacyMixedContentShape(
  source: EditableSourceContext,
  input: Pick<
    AssignmentReplacementInput,
    | "datasetId"
    | "primaryUnitIds"
    | "englishToKoreanRatio"
    | "includePendingReview"
    | "reviewLevels"
    | "reviewScope"
  > & { questionCount?: number },
) {
  const before = source.draft;
  if (before.purpose !== "mixed") return;
  assertAssignmentEditFieldPolicy(source, input);
  if (source.questions === null || source.selectedQueueIds.length === 0) {
    throw new AssignmentReplacementError(
      "conflict",
      "기존 오답 포함 시험의 문제 정보를 확인하지 못해 수정할 수 없습니다.",
    );
  }
  if (source.questions.length !== before.questionCount) {
    throw new AssignmentReplacementError(
      "invalid_selection",
      "기존 오답 포함 시험은 대상 단어와 시험 방식을 유지한 채 문제 순서·시간·점수·마감만 수정할 수 있습니다.",
    );
  }
}
