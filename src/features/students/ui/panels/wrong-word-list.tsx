import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import { StatusBadge } from "@/design-system/primitives/badge/badge";
import { Checkbox } from "@/design-system/primitives/form/field";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";
import type {
  WrongWordAggregate,
  WrongWordOutcome,
} from "@/lib/admin/wrong-word-history";
import { formatKoreanDateTime } from "@/lib/format";

import {
  selectNextExamWrongWordTarget,
  selectWorksheetWrongWordTarget,
  type WrongWordSelectionPurpose,
} from "../../domain/wrong-word-selection";
import styles from "./student-wrong-word-panel.module.css";

function outcomeLabel(outcome: WrongWordOutcome) {
  const copy = adminStudentsText.learning.wrongWordsPanel;
  if (outcome === "recovered_on_retry") return copy.retryRecovered;
  if (outcome === "wrong_again") return copy.retryWrong;
  return copy.retryUnanswered;
}

export function WrongWordList({
  datasetFilter,
  disabled,
  purpose,
  selectedQuestionIds,
  worksheetSelectionLimitReached,
  words,
  onToggleQuestion,
}: {
  datasetFilter: string;
  disabled: boolean;
  onToggleQuestion: (questionId: string) => void;
  purpose: WrongWordSelectionPurpose;
  selectedQuestionIds: readonly string[];
  worksheetSelectionLimitReached: boolean;
  words: readonly WrongWordAggregate[];
}) {
  const copy = adminStudentsText.learning.wrongWordsPanel;

  if (words.length === 0) {
    return <EmptyState>{copy.empty}</EmptyState>;
  }

  return (
    <div className={styles.list}>
      {words.map((word) => {
        const nextExamTarget = selectNextExamWrongWordTarget(
          word,
          datasetFilter,
        );
        const worksheetTarget = selectWorksheetWrongWordTarget(
          word,
          datasetFilter,
        );
        const activeTarget =
          purpose === "next_exam" ? nextExamTarget : worksheetTarget;
        const selected = activeTarget
          ? selectedQuestionIds.includes(activeTarget.questionId)
          : false;

        return (
          <article
            className={styles.row}
            data-selected={selected || undefined}
            data-wrong-level={word.wrongLevel}
            key={word.key}
          >
            <label className={styles.checkbox}>
              <Checkbox
                checked={selected}
                disabled={
                  !activeTarget ||
                  activeTarget.resolution === "resolved" ||
                  (purpose === "next_exam" &&
                    nextExamTarget?.scheduling !== "available") ||
                  (purpose === "worksheet" &&
                    !selected &&
                    worksheetSelectionLimitReached) ||
                  disabled
                }
                onChange={() => {
                  if (activeTarget) {
                    onToggleQuestion(activeTarget.questionId);
                  }
                }}
              />
              <span className="sr-only">
                {formatContentText(copy.wordAria, {
                  word: word.headword,
                  action:
                    purpose === "worksheet"
                      ? copy.addToWorksheet
                      : copy.addToNextExam,
                })}
              </span>
            </label>
            <div className={styles.copy}>
              <strong>{word.headword}</strong>
              <span>{word.primaryMeaning}</span>
              <small>
                {word.occurrences
                  .map((occurrence) => occurrence.datasetLabel)
                  .filter(
                    (value, index, values) =>
                      values.indexOf(value) === index,
                  )
                  .join(" · ")}
              </small>
            </div>
            <div className={styles.meta}>
              <StatusBadge
                tone={
                  nextExamTarget?.resolution === "resolved" ||
                  nextExamTarget?.scheduling === "assigned" ||
                  nextExamTarget?.scheduling === "queued"
                    ? "success"
                    : "neutral"
                }
              >
                {nextExamTarget?.resolution === "resolved"
                  ? copy.resolved
                  : nextExamTarget?.scheduling === "assigned"
                    ? copy.assigned
                    : nextExamTarget?.scheduling === "queued"
                      ? copy.pending
                      : copy.available}
              </StatusBadge>
              <StatusBadge tone={word.wrongLevel === 1 ? "warning" : "danger"}>
                {word.wrongLevel === 1
                  ? copy.once
                  : formatContentText(copy.wrongCount, {
                      count: word.wrongCount,
                    })}
              </StatusBadge>
              <span>{outcomeLabel(word.latestOutcome)}</span>
              <small>{formatKoreanDateTime(word.lastWrongAt)}</small>
              {nextExamTarget?.activeAssignment && (
                <small>{nextExamTarget.activeAssignment.title}</small>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
