import { AssignmentSessionRow } from "./assignment-editor-fields";
import { adminLearningText } from "@/content/ko/admin-learning";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { formatKoreanDateTime } from "@/lib/format";

import type { BulkAssignmentController } from "../controller/use-bulk-assignment-controller";
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

export function BulkSeriesPreview({
  completionGated = false,
  controller,
  students,
}: {
  completionGated?: boolean;
  controller: BulkAssignmentController;
  students: readonly PreviewStudent[];
}) {
  const { message, preview, previewLoading } = controller;
  const labelByStudentId = new Map(
    students.map((student) => [student.id, studentContextLabel(student)]),
  );
  const items = (preview?.items ?? []).map((item) => ({
    ...item,
    studentName: labelByStudentId.get(item.studentId) ?? item.studentName,
  }));
  const audience = buildBulkPlanAudience(preview);
  const summary =
    audience.mode === "common" ? preview?.commonPlanSummary ?? null : null;
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
            <h4>시험 계획</h4>
          </div>
          <small>
            {singleItem.datasetLabel ??
              adminLearningText.bulkAssignmentModal.datasetPending}
          </small>
          <BulkPreviewSessionList
            completionGated={completionGated}
            item={singleItem}
          />
          {singleItem.error ? <small>{singleItem.error}</small> : null}
        </article>
      ) : null}

      {summary ? (
        <article className={styles.previewRow}>
          <div className={styles.studentHeading}>
            <h4>{commonPlanTitle}</h4>
          </div>
          <p className={styles.planCounts}>
            배정 {summary.selectedQuestionCount}개 · 남음{" "}
            {summary.remainingQuestionCount}개
          </p>
          <div className={styles.sessionList}>
            {summary.sessions.map((session) => (
              <AssignmentSessionRow
                className={styles.sessionRow}
                details={
                  <MetaTagList>
                    <MetaTag size="large">{session.unitLabel ?? "선택 범위"}</MetaTag>
                    <MetaTag size="large">
                      {session.availableFrom
                        ? `${formatKoreanDateTime(session.availableFrom)} 공개`
                        : "바로 공개"}
                    </MetaTag>
                    {session.availableUntil ? (
                      <MetaTag size="large">
                        {formatKoreanDateTime(session.availableUntil)} 마감
                      </MetaTag>
                    ) : null}
                    <MetaTag size="large" tone="success">
                      {session.questionCount}개
                    </MetaTag>
                    {completionGated && session.sessionNumber > 1 ? (
                      <MetaTag size="large">완료 후 생성</MetaTag>
                    ) : null}
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
                  completionGated={completionGated}
                  item={item}
                />
                {item.error ? <small>{item.error}</small> : null}
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
