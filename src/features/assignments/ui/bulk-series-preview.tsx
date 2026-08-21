import { AssignmentSessionRow } from "@/components/assignment-editor-ui";
import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { formatKoreanDateTime } from "@/lib/format";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
import type {
  VocabCollisionDecisionInput,
  VocabCollisionDecisionMode,
  VocabCollisionDecisionRecord,
} from "../domain/vocab-collision-decisions";
import type { VocabRangeDistribution } from "../domain/vocab-assignment-plan";
import styles from "./bulk-assignment-editor.module.css";
import { BulkPreviewSessionList } from "./bulk-preview-session-list";
import { CollisionDecisionList } from "./collision-decision-list";

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
  const labelByStudentId = new Map(
    students.map((student) => [student.id, studentContextLabel(student)]),
  );
  const items = (preview?.items ?? []).map((item) => ({
    ...item,
    studentName: labelByStudentId.get(item.studentId) ?? item.studentName,
  }));
  const summary = preview?.commonPlanSummary ?? null;
  const exceptionStudentIds = new Set(summary?.exceptionStudentIds ?? []);
  const visibleItems = summary
    ? items.filter((item) => exceptionStudentIds.has(item.studentId))
    : items;

  return (
    <>
      <div className={styles.previewHeading}>
        <h3>
          <HelpTip
            label="회차별 미리보기 설명"
            trigger={adminLearningText.bulkAssignmentModal.previewTitle}
          >
            공통 일정은 한 번만 보여 주고, 충돌·문항 부족·일정 이동처럼 학생마다 다른 경우만 아래에 따로 표시합니다.
          </HelpTip>
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
      {!preview ? (
        <div className={styles.previewList}>
          <article className={styles.previewRow}>
            <span className={styles.pending}>
              {previewLoading
                ? "실제 문항 수와 일정을 계산하고 있습니다."
                : "단어장·DAY·요일을 정하면 공통 계획을 보여 줍니다."}
            </span>
          </article>
        </div>
      ) : null}
      {summary ? (
        <article className={styles.previewRow}>
          <div className={styles.studentHeading}>
            <strong>공통 배정 계획</strong>
            <MetaTag tone="success">
              동일 적용 {summary.normalStudentIds.length}명
            </MetaTag>
          </div>
          <MetaTagList>
            <MetaTag>출제 가능 {summary.availableQuestionCount}</MetaTag>
            <MetaTag>출제 {summary.selectedQuestionCount}</MetaTag>
            <MetaTag>남음 {summary.remainingQuestionCount}</MetaTag>
          </MetaTagList>
          <div className={styles.sessionList}>
            {summary.sessions.map((session) => (
              <AssignmentSessionRow
                className={styles.sessionRow}
                details={
                  <MetaTagList>
                    <MetaTag>{session.unitLabel ?? "선택 범위"}</MetaTag>
                    <MetaTag>
                      {formatKoreanDateTime(session.availableFrom)} 공개
                    </MetaTag>
                    {session.availableUntil ? (
                      <MetaTag>
                        {formatKoreanDateTime(session.availableUntil)} 마감
                      </MetaTag>
                    ) : null}
                    <MetaTag tone="success">
                      {session.questionCount}문항
                    </MetaTag>
                  </MetaTagList>
                }
                heading={<strong>{session.sessionNumber}회차</strong>}
                key={session.sessionNumber}
              />
            ))}
          </div>
        </article>
      ) : null}
      {visibleItems.length > 0 ? (
        <section aria-label="학생별 확인 필요" className={styles.previewList}>
          {summary ? <strong>확인 필요 {visibleItems.length}명</strong> : null}
          {visibleItems.map((item) => (
            <article className={styles.previewRow} key={item.studentId}>
              <div className={styles.studentHeading}>
                <strong>{item.studentName}</strong>
                <MetaTag tone={item.available ? "warning" : "danger"}>
                  {item.datasetLabel ??
                    adminLearningText.bulkAssignmentModal.datasetPending}
                </MetaTag>
              </div>
              <BulkPreviewSessionList
                includePendingReview={state.draft.review.mode === "pending"}
                item={item}
                onClearCollisionDecision={onClearCollisionDecision}
                onCollisionDecision={onCollisionDecision}
              />
              {item.error ? <small>{item.error}</small> : null}
            </article>
          ))}
        </section>
      ) : null}
      {message ? (
        <div className={styles.message} role="alert">
          {message}
        </div>
      ) : null}
    </>
  );
}
