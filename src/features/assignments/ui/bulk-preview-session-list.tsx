import { AssignmentSessionRow } from "@/components/assignment-editor-ui";
import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { formatKoreanDateTime } from "@/lib/format";

import type { BulkAssignmentPreviewResponse } from "../api/response-adapters";
import {
  buildVocabCollisionDecisionInput,
  vocabCollisionActionPolicy,
  type VocabCollisionDecisionInput,
} from "../domain/vocab-collision-decisions";
import {
  vocabCollisionActionAriaLabel,
  vocabCollisionActionLabels,
} from "../presentation/vocab-collision-actions";
import styles from "./bulk-assignment-editor.module.css";
import plannerStyles from "./vocab-assignment-planner.module.css";

type PreviewItem = BulkAssignmentPreviewResponse["items"][number];

export function BulkPreviewSessionList({
  completionGated = false,
  includePendingReview,
  item,
  onClearCollisionDecision,
  onCollisionDecision,
}: {
  completionGated?: boolean;
  includePendingReview: boolean;
  item: PreviewItem;
  onClearCollisionDecision?: (collisionId: string) => void;
  onCollisionDecision?: (input: VocabCollisionDecisionInput) => void;
}) {
  if (item.sessions.length === 0) {
    return (
      <span className={styles.pending}>
        {item.error ?? adminLearningText.bulkAssignmentModal.rangePending}
      </span>
    );
  }

  return (
    <div className={styles.sessionList}>
      {item.sessions.map((session) => (
        <AssignmentSessionRow
          className={styles.sessionRow}
          details={
            <MetaTagList>
              <MetaTag size="large">
                {session.unitLabel ??
                  adminLearningText.bulkAssignmentModal.rangePending}
              </MetaTag>
              <MetaTag size="large">
                {formatContentText(
                  adminLearningText.bulkAssignmentModal.assignmentDateTag,
                  { datetime: formatKoreanDateTime(session.availableFrom) },
                )}
              </MetaTag>
              {session.availableUntil ? (
                <MetaTag size="large">
                  {formatContentText(
                    adminLearningText.bulkAssignmentModal.deadlineTag,
                    { datetime: formatKoreanDateTime(session.availableUntil) },
                  )}
                </MetaTag>
              ) : null}
              {session.rangeTruncated ? (
                <MetaTag size="large" tone="warning">
                  {adminLearningText.bulkAssignmentModal.rangeMode.remainingOnly}
                </MetaTag>
              ) : null}
              <MetaTag size="large" tone={session.available ? "success" : "danger"}>
                {session.available
                  ? formatContentText(
                      adminLearningText.bulkAssignmentModal.questionCount,
                      { count: session.questionCount },
                    )
                  : adminLearningText.bulkAssignmentModal.needsReview}
              </MetaTag>
              {completionGated && session.sessionNumber > 1 ? (
                <MetaTag size="large">완료 후 생성</MetaTag>
              ) : null}
              {includePendingReview && session.wrongCount > 0 ? (
                <MetaTag size="large" tone="warning">
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
              {session.warnings.map((warning) => {
                const actionPolicy = vocabCollisionActionPolicy(warning.kind);
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
                  <div className={plannerStyles.warning} key={warning.id}>
                    <span>{warning.message}</span>
                    {warning.resolved ? (
                      <MetaTag tone="warning">허용됨</MetaTag>
                    ) : onCollisionDecision ? (
                      <div className={plannerStyles.warningActions}>
                        {actionPolicy.decisionModes.map((mode) => (
                          <Button
                            aria-label={vocabCollisionActionAriaLabel({
                              mode,
                              sourceSessionNumber: session.sourceSessionNumber,
                              studentName: item.studentName,
                              warningKind: warning.kind,
                            })}
                            key={mode}
                            onClick={() => {
                              const decision = buildVocabCollisionDecisionInput(
                                decisionContext,
                                mode,
                              );
                              if (decision) onCollisionDecision(decision);
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
                        {actionPolicy.canClear && onClearCollisionDecision ? (
                          <Button
                            aria-label={`${item.studentName} 원래 ${session.sourceSessionNumber}회 이동 되돌리기`}
                            onClick={() => onClearCollisionDecision(warning.id)}
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
          heading={<strong>{session.sessionNumber}회차</strong>}
          key={`${item.studentId}-${session.sessionNumber}`}
        />
      ))}
    </div>
  );
}
