import {
  AssignmentSessionRow,
} from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import {
  MetaTag,
  MetaTagList,
} from "@/design-system/primitives/badge/badge";
import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";
import { formatKoreanDateTime } from "@/lib/format";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import styles from "./bulk-assignment-editor.module.css";

export function BulkSeriesPreview({
  controller,
  students,
}: {
  controller: BulkAssignmentController;
  students: readonly { id: string; displayName: string }[];
}) {
  const { message, preview, previewLoading, state } = controller;
  const items =
    preview?.items ??
    students.map((student) => ({
      available: false,
      datasetId: null,
      datasetLabel: null,
      error: null,
      sessions: [],
      studentId: student.id,
      studentName: student.displayName,
    }));

  return (
    <>
      <div className={styles.previewHeading}>
        <h3 className={inlineHelpClassName}>
          {adminLearningText.bulkAssignmentModal.previewTitle}
          <HelpTip
            label={adminLearningText.bulkAssignmentModal.atomicHelpAria}
          >
            {adminLearningText.bulkAssignmentModal.atomicHelp}
          </HelpTip>
        </h3>
        <span className={styles.previewSummary}>
          {previewLoading
            ? adminLearningText.bulkAssignmentModal.calculating
            : formatContentText(
                adminLearningText.bulkAssignmentModal.previewSummary,
                {
                  assignable: preview?.assignableCount ?? 0,
                  blocked: preview?.blockedCount ?? 0,
                  sessions: state.draft.range.sessionCount,
                },
              )}
        </span>
      </div>
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
                    error={session.error ? <small>{session.error}</small> : null}
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
                  {adminLearningText.bulkAssignmentModal.rangePending}
                </span>
              )}
            </div>
            {item.error ? <small>{item.error}</small> : null}
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
