"use client";

import { studentAppText } from "@/content/ko/student-app";

import { useQuizPlayerController } from "../controller/use-quiz-player-controller";
import {
  quizChoicesDensity,
  quizPromptDensity,
} from "../domain/quiz-session";
import type { QuizAttempt } from "../model";
import type { QuizChoiceFeedback } from "./quiz-choice";
import { QuizFrame } from "./quiz-frame";
import styles from "./quiz-player.module.css";

export function formatQuizTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function QuizPlayer({
  initialAttempt,
  initialRemainingMilliseconds,
}: {
  initialAttempt: QuizAttempt;
  initialRemainingMilliseconds: number;
}) {
  const controller = useQuizPlayerController({
    initialAttempt,
    initialRemainingMilliseconds,
  });
  const { currentQuestion, state } = controller;

  if (!currentQuestion) {
    return (
      <main className={styles.shell} id="main-content">
        <section className={styles.finalizing}>
          {studentAppText.attempt.finalizing}
        </section>
      </main>
    );
  }

  const choiceDensity = quizChoicesDensity(currentQuestion.choices);
  const promptDensity = quizPromptDensity(
    currentQuestion.prompt,
    currentQuestion.direction,
  );
  const choose = (index: number) => {
    void controller.submitChoice(index);
  };
  const choiceFeedback = (index: number): QuizChoiceFeedback => {
    if (state.feedback?.correct === null || !state.feedback) return null;
    if (state.feedback.correctChoice === index) return "correct";
    if (
      state.feedback.correct === false &&
      state.feedback.selectedChoice === index
    ) {
      return "wrong";
    }
    return null;
  };

  return (
    <main className={styles.shell} id="main-content">
      <QuizFrame
        answerAnnouncement={controller.answerAnnouncement}
        assignmentTitle={state.attempt.assignmentTitle}
        choiceDensity={choiceDensity}
        choiceFeedback={choiceFeedback}
        completedInPhase={controller.completedInPhase}
        currentQuestion={currentQuestion}
        error={state.error}
        formattedRemaining={
          state.timerSynchronized
            ? formatQuizTime(state.remainingSeconds)
            : "--:--"
        }
        onChoose={choose}
        onPlayAudio={controller.playAudio}
        onRetrySynchronization={controller.retrySynchronization}
        phase={state.attempt.phase === "retry" ? "retry" : "initial"}
        phaseQuestionCount={controller.phaseQuestionCount}
        priorWrongIndicator={controller.priorWrongIndicator}
        progress={controller.progress}
        promptAudioUrl={controller.audioPresentation.promptAudioUrl}
        promptDensity={promptDensity}
        promptRef={controller.promptRef}
        remainingSeconds={state.remainingSeconds}
        submitting={
          state.submitting ||
          !state.timerSynchronized ||
          state.remainingSeconds === 0
        }
        timerSynchronized={state.timerSynchronized}
        timeWarning={state.timeWarning}
        timedOut={state.feedback?.timedOut ?? false}
        timingMode={state.attempt.timingMode}
      />
    </main>
  );
}
