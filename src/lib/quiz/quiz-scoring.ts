export type QuizScoreInput = {
  initialIsCorrect: boolean;
  retryIsCorrect: boolean | null;
};

export type QuizScore = {
  initialCorrectCount: number;
  retryCorrectCount: number;
  unresolvedWrongCount: number;
  initialScore: number;
  finalScore: number;
};

export function calculateQuizScore(
  questions: readonly QuizScoreInput[],
): QuizScore {
  if (questions.length === 0) {
    throw new Error("채점할 문항이 없습니다.");
  }

  const initialCorrectCount = questions.filter(
    (question) => question.initialIsCorrect,
  ).length;
  const retryCorrectCount = questions.filter(
    (question) =>
      !question.initialIsCorrect && question.retryIsCorrect === true,
  ).length;
  const unresolvedWrongCount = questions.filter(
    (question) =>
      !question.initialIsCorrect && question.retryIsCorrect !== true,
  ).length;
  const initialScore = (initialCorrectCount / questions.length) * 100;
  const finalScore =
    ((initialCorrectCount + retryCorrectCount) / questions.length) * 100;

  return {
    initialCorrectCount,
    retryCorrectCount,
    unresolvedWrongCount,
    initialScore: Number(initialScore.toFixed(2)),
    finalScore: Number(finalScore.toFixed(2)),
  };
}

