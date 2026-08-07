import {
  isTrustedQuestionSnapshot,
  type QuestionProvenanceStatus,
} from "@/lib/quiz/question-provenance";

export type ResultQuestionPresentationInput = {
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  correctAnswer: string;
  headword: string;
  primaryMeaning: string;
  provenanceStatus: QuestionProvenanceStatus;
};

export type ResultQuestionMetricInput = {
  initialIsCorrect: boolean | null;
  retryIsCorrect: boolean | null;
};

export function getResultQuestionPresentation(
  question: ResultQuestionPresentationInput,
) {
  const headword = question.headword.trim();
  const primaryMeaning = question.primaryMeaning.trim();
  if (
    isTrustedQuestionSnapshot(question.provenanceStatus) &&
    headword &&
    primaryMeaning
  ) {
    return question.direction === "english_to_korean"
      ? {
          prompt: headword,
          correctAnswer: primaryMeaning,
        }
      : {
          prompt: primaryMeaning,
          correctAnswer: headword,
        };
  }

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
