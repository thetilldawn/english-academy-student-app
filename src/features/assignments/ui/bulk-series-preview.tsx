import {
  AssignmentSessionRow,
} from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import {
  MetaTag,
  MetaTagList,
} from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { formatKoreanDateTime } from "@/lib/format";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import {
  buildVocabCollisionDecisionInput,
  vocabCollisionActionPolicy,
  type VocabCollisionDecisionInput,
  type VocabCollisionDecisionRecord,
  type VocabCollisionDecisionMode,
} from "../domain/vocab-collision-decisions";
import type { VocabRangeDistribution } from "../domain/vocab-assignment-plan";
import {
  vocabCollisionActionAriaLabel,
  vocabCollisionActionLabels,
} from "../presentation/vocab-collision-actions";
import { CollisionDecisionList } from "./collision-decision-list";
import styles from "./bulk-assignment-editor.module.css";
import plannerStyles from "./vocab-assignment-planner.module.css";

type PreviewStudent = {
  id: string;
  displayName: string;
  schoolName?: string | null;
  gradeLabel?: string | null;
};

function studentContextLabel(student: PreviewStudent) {
  return [student.displayName, student.schoolName, student.gradeLabel]
    .filter(Boolean)
    .join(" · ");
}

export function BulkSeriesPreview({
  controller,
  collisionDecisions = [],
  distribution = "split",
  onClearCollisionDecision,
  onCollisionDecision,
  onCollisionDecisionChange,
  students,
}: {
  controller: BulkAssignmentController;
  collisionDecisions?: readonly VocabCollisionDecisionRecord[];
  distribution?: VocabRangeDistribution;
  onClearCollisionDecision?: (collisionId: string) => void;
  onCollisionDecision?: (input: VocabCollisionDecisionInput) => void;
  onCollisionDecisionChange?: (
    collisionId: string,
    mode: VocabCollisionDecisionMode,
  ) => void;
  students: readonly PreviewStudent[];
}) {
  const { message, preview, previewLoading, state } = controller;
  const studentLabelById = new Map(
    students.map((student) => [student.id, studentContextLabel(student)]),
  );
  const items = (
    preview?.items ??
    students.map((student) => ({
      available: false,
      datasetId: null,
      datasetLabel: null,
      error: null,
      sessions: [],
      studentId: student.id,
      studentName: studentContextLabel(student),
    }))
  ).map((item) => ({
    ...item,
    studentName: studentLabelById.get(item.studentId) ?? item.studentName,
  }));

  return (
    <>
      <div className={styles.previewHeading}>
        <h3 title={adminLearningText.bulkAssignmentModal.atomicHelp}>
          {adminLearningText.bulkAssignmentModal.previewTitle}
        </h3>
        <span className={styles.previewSummary}>
          {previewLoading
            ? adminLearningText.bulkAssignmentModal.calculating
            : formatContentText(
                adminLearningText.bulkAssignmentModal.previewSummary,
                {
                  assignable: preview?.assignableCount ?? 0,
                  assignments: preview?.assignmentCount ?? 0,
                  blocked: preview?.blockedCount ?? 0,
                },
              )}
        </span>
      </div>
      {onClearCollisionDecision && onCollisionDecisionChange ? (
        <CollisionDecisionList
          decisions={collisionDecisions}
          distribution={distribution}
          onChange={onCollisionDecisionChange}
          onClear={onClearCollisionDecision}
        />
      ) : null}
      <div className={styles.previewList}>
        {items.map((item) => (
          <article className={styles.previewRow} key={item.studentId}>
            <div className={styles.studentHeading}>
              <strong>{item.studentName}</strong>
              <MetaTag>
                {item.datasetLabel ??
                  adminLearningText.bulkAssignmentModal.datasetPending}
              </MetaTag>
            </div>
            <div className={styles.sessionList}>
              {item.sessions.length > 0 ? (
                item.sessions.map((session) => (
                  <AssignmentSessionRow
                    className={styles.sessionRow}
                    details={
                      <MetaTagList>
                        <MetaTag>
                          {session.unitLabel ??
                            adminLearningText.bulkAssignmentModal.rangePending}
                        </MetaTag>
                        <MetaTag>
                          {formatContentText(
                            adminLearningText.bulkAssignmentModal
                              .assignmentDateTag,
                            {
                              datetime: formatKoreanDateTime(
                                session.availableFrom,
                              ),
                            },
                          )}
                        </MetaTag>
                        {session.availableUntil ? (
                          <MetaTag>
                            {formatContentText(
                              adminLearningText.bulkAssignmentModal.deadlineTag,
                              {
                                datetime: formatKoreanDateTime(
                                  session.availableUntil,
                                ),
                              },
                            )}
                          </MetaTag>
                        ) : null}
                        {session.rangeTruncated ? (
                          <MetaTag tone="warning">
                            {
                              adminLearningText.bulkAssignmentModal.rangeMode
                                .remainingOnly
                            }
                          </MetaTag>
                        ) : null}
                        <MetaTag
                          tone={session.available ? "success" : "danger"}
                        >
                          {session.available
                            ? formatContentText(
                                adminLearningText.bulkAssignmentModal
                                  .questionCount,
                                { count: session.questionCount },
                              )
                            : adminLearningText.bulkAssignmentModal.needsReview}
                        </MetaTag>
                        {state.draft.review.mode === "pending" &&
                        session.wrongCount > 0 ? (
                          <MetaTag tone="warning">
                            {formatContentText(
                              adminLearningText.bulkAssignmentModal.wrongCount,
                              { count: session.wrongCount },
                            )}
                          </MetaTag>
                        ) : null}
                      </MetaTagList>
                    }
                    error={
                      <>
                        {session.error ? <small>{session.error}</small> : null}
                        {session.warnings?.map((warning) => {
                          const actionPolicy = vocabCollisionActionPolicy(
                            warning.kind,
                          );
                          const decisionContext = {
                            collisionId: warning.id,
                            availableFrom: session.availableFrom,
                            availableUntil: session.availableUntil,
                            studentId: item.studentId,
                            studentName: item.studentName,
                            sourceSessionNumber: session.sourceSessionNumber,
                            unitLabel: session.unitLabel,
                            warningMessage: warning.message,
                            warningKind: warning.kind,
                          };
                          return (
                            <div
                              className={plannerStyles.warning}
                              key={warning.id}
                            >
                              <span>{warning.message}</span>
                              {warning.resolved ? (
                                <MetaTag tone="warning">허용됨</MetaTag>
                              ) : onCollisionDecision ? (
                                <div className={plannerStyles.warningActions}>
                                  {actionPolicy.decisionModes.map((mode) => (
                                    <Button
                                      aria-label={vocabCollisionActionAriaLabel({
                                        mode,
                                        sourceSessionNumber:
                                          session.sourceSessionNumber,
                                        studentName: item.studentName,
                                        warningKind: warning.kind,
                                      })}
                                      key={mode}
                                      onClick={() => {
                                        const input =
                                          buildVocabCollisionDecisionInput(
                                            decisionContext,
                                            mode,
                                          );
                                        if (input) onCollisionDecision(input);
                                      }}
                                      size="small"
                                      variant={mode === "allow"
                                        ? "primary"
                                        : mode === "skip"
                                          ? "quiet"
                                          : undefined}
                                    >
                                      {vocabCollisionActionLabels[mode]}
                                    </Button>
                                  ))}
                                  {actionPolicy.canClear &&
                                  onClearCollisionDecision ? (
                                    <Button
                                      aria-label={`${item.studentName} 원래 ${session.sourceSessionNumber}회 이동 되돌리기`}
                                      onClick={() =>
                                        onClearCollisionDecision(warning.id)}
                                      size="small"
                                      variant="quiet"
                                    >
                                      이동 되돌리기
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </>
                    }
                    heading={
                      <strong>
                        {formatContentText(
                          adminLearningText.bulkAssignmentModal.sessionLabel,
                          { count: session.sessionNumber },
                        )}
                      </strong>
                    }
                    key={`${item.studentId}-${session.sessionNumber}`}
                  />
                ))
              ) : (
                <span className={styles.pending}>
                  {item.error ??
                    adminLearningText.bulkAssignmentModal.rangePending}
                </span>
              )}
            </div>
            {item.error && item.sessions.length > 0 ? (
              <small>{item.error}</small>
            ) : null}
          </article>
        ))}
      </div>
      {message ? (
        <div className={styles.message} role="alert">
          {message}
        </div>
      ) : null}
    </>
  );
}
