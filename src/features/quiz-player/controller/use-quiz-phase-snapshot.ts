"use client";

import { useMemo } from "react";

import {
  currentQuizQuestion,
  quizPhaseQuestions,
} from "../domain/quiz-session";
import type { QuizAttempt } from "../model";

export function useQuizPhaseSnapshot(attempt: QuizAttempt) {
  const currentQuestion = useMemo(
    () => currentQuizQuestion(attempt),
    [attempt],
  );
  const phaseSnapshot = useMemo(() => {
    const questions = quizPhaseQuestions(attempt);
    const completed = questions.filter((question) =>
      attempt.phase === "retry"
        ? question.retryIsCorrect !== null
        : question.initialIsCorrect !== null,
    ).length;
    return {
      completed,
      progress:
        questions.length === 0
          ? 100
          : Math.round((completed / questions.length) * 100),
      questions,
    };
  }, [attempt]);
  return { currentQuestion, phaseSnapshot };
}
