import { adminLearningText } from "@/content/ko/admin-learning";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";

import type { BulkAssignmentCommonPlanSummary, BulkAssignmentPreviewItem } from "../contracts/bulk-assignment-response";
import {
  buildBulkPlanAudience,
  bulkPlanItemStatus,
  type BulkPlanItemStatus,
} from "../presentation/bulk-plan-audience";
import styles from "./vocab-assignment-form.module.css";
import { BulkPreviewSessionList } from "./bulk-preview-session-list";

type PreviewStudent = {
  id: string;
  displayName: string;
  schoolName?: string | null;
  gradeLabel?: string | null;
};

const itemStatusPresentation: Record<
  BulkPlanItemStatus,
  { label: string; tone: "danger" | "neutral" | "success" | "warning" }
> = {
  same: { label: "동일 조건", tone: "success" },
  different: { label: "다른 조건", tone: "warning" },
  blocked: { label: "배정 불가", tone: "danger" },
  individual: { label: "개별 계획", tone: "neutral" },
};

function studentContextLabel(student: PreviewStudent) {
  return [student.displayName, student.schoolName, student.gradeLabel]
    .filter(Boolean)
    .join(" · ");
}

export type BulkSeriesPreviewProps = {
  message: string | null;
  previewLoading: boolean;
  preview: { items: BulkAssignmentPreviewItem[]; commonPlanSummary: BulkAssignmentCommonPlanSummary | null } | null;
  students: readonly PreviewStudent[];
};

export function BulkSeriesPreview({
  message,
  preview,
  previewLoading,
  students,
}: BulkSeriesPreviewProps) {
  const labelByStudentId = new Map(
    students.map((student) => [student.id, studentContextLabel(student)]),
  );
  const items = (preview?.items ?? []).map((item) => ({
    ...item,
    studentName: labelByStudentId.get(item.studentId) ?? item.studentName,
  }));
  const audience = buildBulkPlanAudience(preview);
  const requestedSummary =
    audience.mode === "common" ? preview?.commonPlanSummary ?? null : null;
  const representative = requestedSummary ? items.find(item => item.studentId === requestedSummary.representativeStudentId) : null;
  const summary = requestedSummary && representative && representative.sessions.length === requestedSummary.sessions.length &&
    requestedSummary.sessions.every(expected => representative.sessions.some(actual =>
      actual.sessionNumber === expected.sessionNumber && actual.questionCount === expected.questionCount &&
      actual.availableFrom === expected.availableFrom && actual.availableUntil === expected.availableUntil))
    ? requestedSummary : null;
  const singleItem = audience.mode === "single" ? items[0] ?? null : null;
  const normalStudentIds = summary
    ? new Set(summary.normalStudentIds)
    : undefined;
  const exceptionStudentIds = new Set(summary?.exceptionStudentIds ?? []);
  const visibleItems = singleItem
    ? []
    : summary
      ? items.filter((item) => exceptionStudentIds.has(item.studentId))
      : items;
  const commonPlanTitle =
    summary && summary.exceptionStudentIds.length === 0
      ? "공통 일정"
      : "기준 일정";
  const previewErrorMessages = Array.from(new Set(items.flatMap((item) => [
    item.error,
    ...item.sessions.map((session) => session.error),
  ]).filter((value): value is string => Boolean(value))));
  const describedBy = [
    message ? "bulk-series-preview-message" : null,
    previewErrorMessages.length > 0 ? "bulk-series-preview-errors" : null,
  ].filter(Boolean).join(" ") || undefined;
  const completeItems = items.length > 0 && !previewLoading && items.every(item => item.available && !item.error &&
    item.sessions.length > 0 && item.sessions.every(session => session.available && !session.error));
  const totalSessions = completeItems ? items.reduce((sum, item) => sum + item.sessions.length, 0) : null;
  const totalQuestions = completeItems ? items.reduce((sum, item) =>
    sum + item.sessions.reduce((count, session) => count + session.questionCount, 0), 0) : null;

  return (
    <section
      aria-busy={previewLoading}
      aria-describedby={describedBy}
      aria-labelledby="bulk-series-preview-title"
      className={styles.previewRoot}
      data-field-key="preview"
      tabIndex={-1}
    >
      {previewErrorMessages.length > 0 ? (
        <span className="sr-only" id="bulk-series-preview-errors">
          {previewErrorMessages.join(" ")}
        </span>
      ) : null}
      <div className={styles.previewHeading}>
        <h3 id="bulk-series-preview-title">
          <HelpTip
            label="배정 미리보기 설명"
            trigger={adminLearningText.bulkAssignmentModal.previewTitle}
          >
            저장 전에 배정될 범위와 날짜를 확인합니다.
          </HelpTip>
        </h3>
      </div>

      {items.length > 1 ? <p className={styles.planCounts} aria-live="polite">
        {completeItems
          ? `전체 ${items.length}명 · ${totalSessions}회 · ${totalQuestions}문항 (반복 포함)`
          : "전체 합계는 모든 학생의 조건을 확인한 뒤 표시합니다."}
      </p> : null}

      {!preview ? (
        <div className={styles.previewList}>
          <article className={styles.previewRow}>
            <span className={styles.pending} role="status">
              {previewLoading
                ? "실제 단어 수와 일정을 계산하고 있습니다."
                : "범위와 일정을 정하면 배정 계획을 보여 줍니다."}
            </span>
          </article>
        </div>
      ) : null}

      {singleItem ? (
        <article className={styles.previewRow}>
          <div className={styles.studentHeading}>
            <h4>배정 학생</h4>
            <MetaTag>{singleItem.studentName}</MetaTag>
          </div>
          <BulkPreviewSessionList
            item={singleItem}
          />
          {singleItem.error &&
              singleItem.sessions.length > 0 &&
              !singleItem.sessions.some(
                (session) => session.error === singleItem.error,
              )
            ? <small>{singleItem.error}</small>
            : null}
        </article>
      ) : null}

      {summary ? (
        <article className={styles.previewRow}>
          <div className={styles.studentHeading}>
            <h4>배정 학생</h4>
            <MetaTagList>{items.filter(item => normalStudentIds?.has(item.studentId)).map(item => <MetaTag key={item.studentId}>{item.studentName}</MetaTag>)}</MetaTagList>
          </div>
          <small>{commonPlanTitle}</small>
          {representative ? <BulkPreviewSessionList item={representative} /> : null}
        </article>
      ) : null}

      {visibleItems.length > 0 ? (
        <section
          aria-labelledby="bulk-series-student-plans-title"
          className={styles.previewList}
        >
          <h4 id="bulk-series-student-plans-title">
            {summary ? "별도 확인" : "학생별 계획"}
          </h4>
          {visibleItems.map((item) => {
            const status = itemStatusPresentation[
              bulkPlanItemStatus(item, normalStudentIds)
            ];
            return (
              <article className={styles.previewRow} key={item.studentId}>
                <div className={styles.studentHeading}>
                  <strong>{item.studentName}</strong>
                  <MetaTag tone={status.tone}>{status.label}</MetaTag>
                </div>
                <small>
                  {item.datasetLabel ??
                    adminLearningText.bulkAssignmentModal.datasetPending}
                </small>
                <BulkPreviewSessionList
                  item={item}
                />
                {item.error &&
                    item.sessions.length > 0 &&
                    !item.sessions.some(
                      (session) => session.error === item.error,
                    )
                  ? <small>{item.error}</small>
                  : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {message ? (
        <div
          className={styles.message}
          id="bulk-series-preview-message"
          role="alert"
        >
          {message}
        </div>
      ) : null}
    </section>
  );
}
