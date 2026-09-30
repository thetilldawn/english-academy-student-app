"use client";
import { practiceQuizTransport } from "../api/quiz-transport";
import type { QuizAttemptResponse } from "../model";
import { QuizPlayer } from "../ui/quiz-player";
export function PracticePlayer({ initial }: { initial: QuizAttemptResponse }) {
  return <QuizPlayer initialAttempt={initial.attempt} initialRemainingMilliseconds={initial.timerRemainingMilliseconds}
    transport={practiceQuizTransport} phaseLabel="자율연습" />;
}
