"use client";
import type { RefObject } from "react";

import { studentAppText } from "@/content/ko/student-app";
import type { QuizTransport } from "../api/quiz-transport";

import { useQuizPlayerController } from "../controller/use-quiz-player-controller";
import {
  quizAttemptUsesDeadlineClock,
  quizChoicesDensity,
  quizPromptDensity,
} from "../domain/quiz-session";
import type { QuizAttempt, QuizAttemptResponse } from "../model";
import { Button, ButtonLink, ButtonSpinner } from "@/design-system/primitives/button/button";
import type { QuizChoiceFeedback } from "./quiz-choice";
import { QuizFrame } from "./quiz-frame";
import { QuizExitDialog } from "./quiz-exit-dialog";
import styles from "./quiz-player.module.css";

export function formatQuizTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function QuizPlayer({
  initialAttempt,
  initialRemainingMilliseconds,
  transport,
  phaseLabel,
  initialTimerReady,
  preparation,
}: {
  initialAttempt: QuizAttempt;
  initialRemainingMilliseconds: number;
  transport?: QuizTransport;
  phaseLabel?: string;
  initialTimerReady?: boolean;
  preparation?: { response: (QuizAttemptResponse & {receivedAt:number}) | null; error:string; retry?:(()=>void); frameRef:RefObject<HTMLDivElement|null> };
}) {
  const controller = useQuizPlayerController({
    initialAttempt,
    initialRemainingMilliseconds,
    transport,
    initialTimerReady,
    preparedResponse: preparation?.response,
  });
  const { currentQuestion, state, stopOpen } = controller;
  // A later question or recovery also pauses timer synchronization. Only the
  // first clock receipt owns the initial preparation screen.
  const initialPreparing = Boolean(preparation) && state.attempt.startedAt === null;

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
    currentQuestion.quizContentMode ?? state.attempt.quizContentMode,
  );
  const choose = (index: number) => {
    void controller.submitChoice(index);
  };
  const choiceFeedback = (index: number): QuizChoiceFeedback => {
    if (!state.feedback) {
      return state.pendingChoice === index ? "selected" : null;
    }
    if (state.feedback.correct === null) {
      return state.feedback.selectedChoice === index ? "selected" : null;
    }
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
    <><main className={styles.shell} id="main-content">
      <div className={styles.stage} ref={preparation?.frameRef} aria-busy={initialPreparing || state.transitionPending}>
      <div className={initialPreparing ? styles.initialHidden : state.transitionPending ? styles.waiting : state.revealQuestion ? styles.reveal : undefined}
        inert={initialPreparing || state.transitionPending || undefined} aria-hidden={initialPreparing || state.transitionPending || undefined}>
      <QuizFrame
        phaseLabel={phaseLabel}
        answerAnnouncement={controller.answerAnnouncement}
        assignmentTitle={state.attempt.assignmentTitle}
        choiceDensity={choiceDensity}
        choiceFeedback={choiceFeedback}
        completedInPhase={controller.completedInPhase}
        currentQuestion={currentQuestion}
        error={state.error}
        formattedRemaining={
          state.attempt.timingMode === "none"
            ? "제한 없음"
            : state.timerSynchronized
            ? formatQuizTime(state.remainingSeconds)
            : "--:--"
        }
        onChoose={choose}
        onPlayAudio={url => { if (!stopOpen) controller.playAudio(url); }}
        onRetrySynchronization={controller.retrySynchronization}
        phase={state.attempt.phase === "retry" ? "retry" : "initial"}
        phaseQuestionCount={controller.phaseQuestionCount}
        priorWrongIndicator={controller.priorWrongIndicator}
        progress={controller.progress}
        promptAudioUrl={controller.audioPresentation.promptAudioUrl}
        promptDensity={promptDensity}
        promptRef={controller.promptRef}
        quizContentMode={state.attempt.quizContentMode}
        remainingSeconds={state.remainingSeconds}
        timerLimitMilliseconds={state.attempt.timingMode === "per_question"
          ? (state.attempt.questionTimeLimitSeconds ?? 0) * 1000
          : state.attempt.deadlineAt && state.attempt.startedAt ? Date.parse(state.attempt.deadlineAt) - Date.parse(state.attempt.startedAt) : null}
        answerCorrect={state.feedback?.correct ?? null}
        onRequestStop={controller.requestStop}
        stopDisabled={state.submitting || state.pendingChoice !== null || Boolean(state.feedback)}
        submitting={
          stopOpen ||
          state.submitting ||
          !state.timerSynchronized ||
          (quizAttemptUsesDeadlineClock(state.attempt) &&
            state.remainingSeconds === 0)
        }
        timerSynchronized={state.timerSynchronized}
        timeWarning={state.timeWarning}
        timedOut={state.feedback?.timedOut ?? false}
        timingMode={state.attempt.timingMode}
      />
      </div>
      {state.savingSlow ? <p role="status">답이 저장됐는지 확인하고 있습니다.</p> : null}
      {state.expirationPending ? <p role="status">시험 종료를 확인하고 있습니다.</p> : null}
      {initialPreparing ? <div className={styles.initialPreparing}>
        <strong>{state.attempt.assignmentTitle}</strong>
        <div className={styles.prepareBody}>{preparation?.error ? <><p role="alert">{preparation.error}</p>{preparation.retry ? <Button onClick={preparation.retry}>다시 확인</Button> : null}</> : <p role="status" className={styles.loadingStatus}><ButtonSpinner className={styles.loadingSpinner} />시험 준비 중</p>}<ButtonLink href="/student">취소</ButtonLink></div>
      </div> : null}
      {state.transitionPending ? <div className={styles.preparing} role="status">다음 문제 준비 중</div> : null}
      </div>
    </main>{stopOpen ? <QuizExitDialog onContinue={controller.continueQuiz} onExit={controller.exitQuiz} /> : null}</>
  );
}
