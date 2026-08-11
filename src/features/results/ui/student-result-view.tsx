import { formatContentText } from "@/content/format";
import { studentAppText } from "@/content/ko/student-app";
import { CountBadge } from "@/design-system/primitives/badge/badge";
import { ButtonLink } from "@/design-system/primitives/button/button";
import { formatElapsed } from "@/lib/format";
import { getResultQuestionPresentation } from "@/lib/quiz/result-presentation";

import type {
  AttemptResultQuestion,
  StudentAttemptResult,
} from "../model";
import { AttemptQuestionCard } from "./attempt-question-card";
import {
  ResultEmptyState,
  ResultLayout,
  ResultSection,
  resultLayoutStyles,
} from "./result-layout";
import { StartRetryButton } from "./start-retry-button";
import styles from "./student-result-view.module.css";

function answerDensity(answer: string) {
  const length = Array.from(answer).length;
  if (length >= 54) return "very-long";
  if (length >= 30) return "long";
  return "default";
}

function QuestionReviewCard({
  question,
}: {
  question: AttemptResultQuestion;
}) {
  const presentation = getResultQuestionPresentation(question);
  const wrongLevel = question.wrongCount >= 2 ? 2 : 1;

  return (
    <AttemptQuestionCard
      eyebrow={formatContentText(studentAppText.result.question.number, {
        number: question.orderIndex,
      })}
      prompt={presentation.prompt}
      wrongLevel={wrongLevel}
    >
      <div className={styles.answerBlock}>
        <span className={styles.answerLabel}>
          {studentAppText.result.question.answer}
        </span>
        <div
          className={styles.answer}
          data-density={answerDensity(presentation.correctAnswer)}
          data-language={
            question.direction === "korean_to_english" ? "english" : "korean"
          }
        >
          <span aria-hidden="true" className={styles.answerNumber}>
            {question.correctChoiceIndex + 1}
          </span>
          <span className={styles.answerCopy}>{presentation.correctAnswer}</span>
        </div>
      </div>
    </AttemptQuestionCard>
  );
}

function ResultHeader({
  expired,
  hasRetryResult,
  result,
  reviewPending,
}: {
  expired: boolean;
  hasRetryResult: boolean;
  result: StudentAttemptResult;
  reviewPending: boolean;
}) {
  const eyebrow = reviewPending
    ? studentAppText.result.eyebrow.reviewPending
    : expired
      ? studentAppText.result.eyebrow.expired
      : result.passed
        ? studentAppText.result.eyebrow.passed
        : studentAppText.result.eyebrow.completed;
  const message = reviewPending
    ? studentAppText.result.message.retryReady
    : expired
      ? studentAppText.result.message.expired
      : hasRetryResult
        ? result.unresolvedWrongCount === 0
          ? studentAppText.result.message.retryResolved
          : studentAppText.result.message.retryRemaining
        : result.passed
        ? studentAppText.result.message.passed
        : studentAppText.result.message.failed;
  const displayedScore = hasRetryResult
    ? result.finalScore
    : result.initialScore;

  return (
    <header className={styles.header} data-expired={expired || undefined}>
      <div className={styles.headerCopy}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{result.title}</h1>
        <p>{message}</p>
      </div>
      <strong className={styles.score}>
        {displayedScore === null
          ? "-"
          : formatContentText(studentAppText.result.score, {
              score: displayedScore,
            })}
      </strong>
    </header>
  );
}

function ResultMetrics({
  result,
  reviewPending,
}: {
  result: StudentAttemptResult;
  reviewPending: boolean;
}) {
  return (
    <>
      <section
        aria-label={studentAppText.result.summary.aria}
        className={styles.metricList}
      >
        <div>
          <span>{studentAppText.result.summary.initialCorrect}</span>
          <strong>
            {result.initialCorrectCount ?? "-"}
            <small>/{result.questionCount}</small>
          </strong>
        </div>
        <div>
          <span>{studentAppText.result.summary.retryCorrect}</span>
          <strong>
            {reviewPending ? "-" : (result.retryCorrectCount ?? "-")}
          </strong>
        </div>
        <div>
          <span>
            {reviewPending
              ? studentAppText.result.summary.retryTarget
              : studentAppText.result.summary.unresolved}
          </span>
          <strong>{result.unresolvedWrongCount ?? "-"}</strong>
        </div>
      </section>

      <section className={styles.summary}>
        <div>
          <span>{studentAppText.result.summary.finalScore}</span>
          <strong>
            {reviewPending || result.finalScore === null
              ? "-"
              : formatContentText(studentAppText.result.score, {
                  score: result.finalScore,
                })}
          </strong>
        </div>
        <div>
          <span>{studentAppText.result.summary.elapsed}</span>
          <strong>{formatElapsed(result.elapsedSeconds)}</strong>
        </div>
        <div>
          <span>{studentAppText.result.summary.attemptNumber}</span>
          <strong>
            {formatContentText(studentAppText.result.attemptCount, {
              count: result.attemptNumber,
            })}
          </strong>
        </div>
      </section>
    </>
  );
}

export function StudentResultView({ result }: { result: StudentAttemptResult }) {
  const reviewPending =
    result.status === "in_progress" && result.phase === "review";
  const expired = result.status === "expired";
  const wrongQuestions = result.questions.filter(
    (question) => question.initialIsCorrect === false,
  );
  const unresolvedQuestions = wrongQuestions.filter(
    (question) => question.retryIsCorrect !== true,
  );
  const resolvedQuestions = wrongQuestions.filter(
    (question) => question.retryIsCorrect === true,
  );
  const hasRetryResult = wrongQuestions.some(
    (question) => question.retryIsCorrect !== null,
  );

  const unresolved = (
    <ResultSection
      count={
        <CountBadge>
          {formatContentText(studentAppText.result.count, {
            count: unresolvedQuestions.length,
          })}
        </CountBadge>
      }
      heading={
        reviewPending
          ? studentAppText.result.sections.firstWrong
          : studentAppText.result.sections.unresolved
      }
      headingId="unresolved-heading"
    >
      {unresolvedQuestions.length === 0 ? (
        <ResultEmptyState>
          {reviewPending
            ? studentAppText.result.empty.noInitialWrong
            : studentAppText.result.empty.noUnresolved}
        </ResultEmptyState>
      ) : (
        <div className={resultLayoutStyles.list}>
          {unresolvedQuestions.map((question) => (
            <QuestionReviewCard key={question.id} question={question} />
          ))}
        </div>
      )}
    </ResultSection>
  );

  const sidebar = (
    <>
      <ResultMetrics result={result} reviewPending={reviewPending} />
      {reviewPending ? <StartRetryButton attemptId={result.id} /> : null}
      <ButtonLink
        href="/student"
        variant={reviewPending ? "quiet" : "primary"}
      >
        {studentAppText.result.backToAssignments}
      </ButtonLink>
    </>
  );

  const resolved =
    resolvedQuestions.length > 0 ? (
      <ResultSection
        count={
          <CountBadge>
            {formatContentText(studentAppText.result.count, {
              count: resolvedQuestions.length,
            })}
          </CountBadge>
        }
        heading={studentAppText.result.sections.resolved}
        headingId="resolved-heading"
      >
        <div
          className={`${resultLayoutStyles.list} ${resultLayoutStyles.grid}`}
        >
          {resolvedQuestions.map((question) => (
            <QuestionReviewCard key={question.id} question={question} />
          ))}
        </div>
      </ResultSection>
    ) : undefined;

  return (
    <ResultLayout
      header={
        <ResultHeader
          expired={expired}
          hasRetryResult={hasRetryResult}
          result={result}
          reviewPending={reviewPending}
        />
      }
      primary={unresolved}
      secondary={resolved}
      sidebar={sidebar}
    />
  );
}
