export type ResultQuestionPresentationInput = {
  prompt: string;
  correctAnswer: string;
};

export type ResultQuestionMetricInput = {
  initialIsCorrect: boolean | null;
  retryIsCorrect: boolean | null;
};

export function getResultQuestionPresentation(
  question: ResultQuestionPresentationInput,
) {
  return {
    prompt: question.prompt,
    correctAnswer: question.correctAnswer,
  };
}

export function deriveAttemptQuestionMetrics(
  questions: ResultQuestionMetricInput[],
) {
  const questionCount = questions.length;
  const initialCorrectCount = questions.filter(
    (question) => question.initialIsCorrect === true,
  ).length;
  const retryCorrectCount = questions.filter(
    (question) =>
      question.initialIsCorrect === false &&
      question.retryIsCorrect === true,
  ).length;
  const unresolvedWrongCount = questions.filter(
    (question) =>
      question.initialIsCorrect === false &&
      question.retryIsCorrect !== true,
  ).length;
  const initialScore =
    questionCount === 0
      ? 0
      : Math.round((initialCorrectCount / questionCount) * 10_000) / 100;

  return {
    questionCount,
    initialCorrectCount,
    retryCorrectCount,
    unresolvedWrongCount,
    initialScore,
  };
}
