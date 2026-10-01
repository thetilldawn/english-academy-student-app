"use client";

import type { PreparedQuiz } from "../contracts/preparation";
import { practiceQuizTransport } from "../api/quiz-transport";
import { usePreparedQuiz } from "../controller/use-prepared-quiz";
import { QuizPlayer } from "./quiz-player";

// The real frame and its code mount before the server starts the clock.
export function PreparedQuizPlayer({ preparation }: { preparation: PreparedQuiz }) {
  const controller = usePreparedQuiz(preparation);
  return <QuizPlayer initialAttempt={controller.display} initialRemainingMilliseconds={0}
    preparation={controller.state}
    transport={preparation.kind === "practice" ? practiceQuizTransport : undefined}
    phaseLabel={preparation.kind === "practice" ? "자율연습" : undefined} />;
}

