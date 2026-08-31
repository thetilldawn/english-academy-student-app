import type { KeyboardEvent, RefObject } from "react";

import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import { PronunciationText } from "@/components/pronunciation-text";
import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";
import { AudioButton } from "@/design-system/patterns/audio-button/audio-button";
import type { PriorWrongIndicator } from "@/lib/quiz/prior-wrong";

import type { QuizChoiceLength } from "../domain/quiz-session";
import type { QuizQuestion } from "../model";
import { QuizChoice, type QuizChoiceFeedback } from "./quiz-choice";
import { QuizSynchronizationError } from "./quiz-synchronization-error";
import { QuizTimeoutOverlay } from "./quiz-timeout-overlay";
import styles from "./quiz-frame.module.css";

function shouldIgnoreShortcut(event: KeyboardEvent<HTMLElement>) {
  const target = event.target;
  return (
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function QuizFrame({
  answerAnnouncement,
  assignmentTitle,
  choiceDensity,
  choiceFeedback,
  completedInPhase,
  currentQuestion,
  error,
  formattedRemaining,
  onChoose,
  onPlayAudio,
  onRetrySynchronization,
  phase,
  phaseQuestionCount,
  priorWrongIndicator,
  progress,
  promptAudioUrl,
  promptDensity,
  promptRef,
  remainingSeconds,
  submitting,
  timerSynchronized,
  timeWarning,
  timedOut,
  timingMode,
}: {
  answerAnnouncement: string;
  assignmentTitle: string;
  choiceDensity: QuizChoiceLength;
  choiceFeedback: (index: number) => QuizChoiceFeedback;
  completedInPhase: number;
  currentQuestion: QuizQuestion;
  error: string;
  formattedRemaining: string;
  onChoose: (index: number) => void;
  onPlayAudio: (audioUrl: string | null) => void;
  onRetrySynchronization: () => void;
  phase: "initial" | "retry";
  phaseQuestionCount: number;
  priorWrongIndicator: PriorWrongIndicator | null;
  progress: number;
  promptAudioUrl: string | null;
  promptDensity: QuizChoiceLength;
  promptRef: RefObject<HTMLHeadingElement | null>;
  remainingSeconds: number;
  submitting: boolean;
  timerSynchronized: boolean;
  timeWarning: string;
  timedOut: boolean;
  timingMode: "none" | "total" | "per_question";
}) {
  const isEnglishPrompt =
    currentQuestion.direction === "english_to_korean";
  const isEnglishChoice =
    currentQuestion.direction === "korean_to_english";
  const progressLabel =
    phase === "retry"
      ? formatContentText(studentAppText.attempt.retryProgress, {
          current: completedInPhase + 1,
          total: phaseQuestionCount,
        })
      : `${currentQuestion.orderIndex}/${phaseQuestionCount}`;

  return (
    <section
      className={styles.frame}
      onKeyDown={(event) => {
        if (submitting || shouldIgnoreShortcut(event)) return;
        const choiceIndex = Number(event.key) - 1;
        if (
          Number.isInteger(choiceIndex) &&
          choiceIndex >= 0 &&
          choiceIndex < currentQuestion.choices.length
        ) {
          event.preventDefault();
          onChoose(choiceIndex);
        }
      }}
    >
      <div className={styles.topline}>
        <div className={styles.heading}>
          <p className={styles.phase}>
            {phase === "retry"
              ? studentAppText.attempt.retryPhase
              : studentAppText.attempt.initialPhase}
          </p>
          <strong className={styles.title}>{assignmentTitle}</strong>
        </div>
        <span
          aria-busy={!timerSynchronized}
          aria-label={formatContentText(studentAppText.attempt.remaining, {
            prefix:
              timingMode === "per_question"
                ? studentAppText.attempt.perQuestionPrefix
                : "",
            time: formattedRemaining,
          })}
          className={[
            styles.timer,
            timingMode !== "none" && timerSynchronized && remainingSeconds <= 30
              ? styles.timerWarning
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid="quiz-timer"
        >
          {timingMode === "per_question" ? <small className={styles.timerLabel}>문제당</small> : null}
          <span>{formattedRemaining}</span>
        </span>
      </div>

      <div
        aria-label={formatContentText(studentAppText.attempt.progressAria, {
          percent: progress,
        })}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className={[
          styles.progressTrack,
          timingMode !== "none" && timerSynchronized && remainingSeconds <= 30
            ? styles.progressWarning
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="progressbar"
      >
        <div
          className={styles.progressValue}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className={styles.direction}>
        <span className={inlineHelpClassName}>
          <HelpTip label={studentAppText.attempt.keyboardShortcutAria} trigger={progressLabel}>
            {studentAppText.attempt.keyboardShortcutHelp}
          </HelpTip>
        </span>
        <span className="sr-only">
          {isEnglishPrompt
            ? studentAppText.attempt.chooseMeaning
            : studentAppText.attempt.chooseEnglish}
        </span>
      </p>

      <div className={styles.priorWrongSlot}>
        {priorWrongIndicator ? (
          <div
            className={[
              styles.priorWrong,
              priorWrongIndicator.markerCount === 2
                ? styles.priorWrongRepeated
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            id="quiz-prior-wrong"
          >
            <span aria-hidden="true" className={styles.priorWrongMarks}>
              {Array.from(
                { length: priorWrongIndicator.markerCount },
                (_, index) => (
                  <i key={index}>!</i>
                ),
              )}
            </span>
            <span>{priorWrongIndicator.label}</span>
          </div>
        ) : null}
      </div>

      <div
        className={[
          styles.promptRow,
          promptAudioUrl ? styles.promptWithAudio : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <h1
          aria-describedby={
            priorWrongIndicator ? "quiz-prior-wrong" : undefined
          }
          className={[
            styles.prompt,
            isEnglishPrompt ? styles.promptEnglish : styles.promptKorean,
            styles[`prompt-${promptDensity}`],
          ].join(" ")}
          data-question-id={currentQuestion.id}
          id="quiz-prompt"
          ref={promptRef}
          tabIndex={-1}
        >
          <span>{currentQuestion.prompt}</span>
          {isEnglishPrompt && currentQuestion.pronunciation.displayKo ? (
            <PronunciationText className={styles.promptPronunciation} pronunciation={currentQuestion.pronunciation} />
          ) : null}
        </h1>
        {promptAudioUrl ? (
          <AudioButton
            disabled={submitting}
            label={formatContentText(
              studentAppText.attempt.pronunciationAria,
              { word: currentQuestion.prompt },
            )}
            onClick={() => onPlayAudio(promptAudioUrl)}
            variant="prompt"
          />
        ) : null}
      </div>

      <div
        aria-labelledby="quiz-prompt"
        className={styles.choiceList}
        role="group"
      >
        {currentQuestion.choices.map((choice, index) => (
          <QuizChoice
            audioEnabled={
              isEnglishChoice &&
              currentQuestion.choicePronunciations[index]?.available === true
            }
            choice={choice}
            density={choiceDensity}
            disabled={submitting}
            feedback={choiceFeedback(index)}
            index={index}
            isEnglish={isEnglishChoice}
            key={`${currentQuestion.id}:${index}`}
            onChoose={() => onChoose(index)}
            onPlayAudio={() =>
              onPlayAudio(
                currentQuestion.choicePronunciations[index]?.audioUrl ??
                  null,
              )
            }
            pronunciation={currentQuestion.choicePronunciations[index]}
          />
        ))}
      </div>

      <span
        aria-atomic="true"
        aria-live="assertive"
        className="sr-only"
        role="status"
      >
        {answerAnnouncement}
      </span>
      <QuizSynchronizationError
        message={error}
        onRetry={
          error && !timerSynchronized
            ? onRetrySynchronization
            : undefined
        }
      />
      <span aria-live="assertive" className="sr-only" role="status">
        {timeWarning}
      </span>
      <QuizTimeoutOverlay visible={timedOut} />
    </section>
  );
}
