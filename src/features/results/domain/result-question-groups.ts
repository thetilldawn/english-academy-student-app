import type {
  AttemptResultQuestion,
  StudentAttemptResult,
} from "../model";

export type ResultQuestionGroups = {
  hasRetryResult: boolean;
  resolved: AttemptResultQuestion[];
  unresolved: AttemptResultQuestion[];
  wrong: AttemptResultQuestion[];
};

export function selectResultQuestionGroups(
  result: Pick<StudentAttemptResult, "questions" | "status">,
): ResultQuestionGroups {
  const wrong = result.questions.flatMap((question) => {
    if (question.initialIsCorrect === false) return [question];
    if (result.status !== "expired" || question.initialIsCorrect !== null) {
      return [];
    }
    return [
      {
        ...question,
        initialIsCorrect: false,
        wrongCount: Math.max(0, question.wrongCount) + 1,
      },
    ];
  });
  return {
    hasRetryResult: wrong.some((question) => question.retryIsCorrect !== null),
    resolved: wrong.filter((question) => question.retryIsCorrect === true),
    unresolved: wrong.filter((question) => question.retryIsCorrect !== true),
    wrong,
  };
}
