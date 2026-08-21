import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import {
  ActivityRow,
  SelectableRow,
} from "@/design-system/patterns/activity-row/activity-row";
import { ActionWithReason } from "@/design-system/patterns/action-reason/action-reason";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { ActivityStatusTimeline } from "@/features/history/ui/activity-status-timeline";
import { AssignmentQueueTags } from "@/features/assignment-queue/ui/assignment-queue-tags";
import { AssignmentMetaTags } from "@/features/history/ui/assignment-meta-tags";
import { AttemptScoreSummary } from "@/features/history/ui/attempt-score-summary";
import learningRowStyles from "@/features/history/ui/learning-management-row.module.css";
import { hasAttemptScoreContent } from "@/features/history/presentation/attempt-presentation";
import { assignmentDisplayTitle } from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";
import { learningSourceTypeLabel } from "@/lib/admin/learning-sources";

import type { AssignmentStudentItem } from "../catalog-types";
import {
  studentActivities,
  studentPendingReviewCounts,
  type AssignmentWorkspaceController,
} from "../controller/use-assignment-workspace";
import { assignmentRecommendationLabel } from "../presentation/assignment-recommendation";

export function AssignmentStudentRow({
  controller,
  student,
}: {
  controller: AssignmentWorkspaceController;
  student: AssignmentStudentItem;
}) {
  const activities = studentActivities(controller, student.id);
  const assignmentQueues =
    controller.assignmentQueuesByStudent.get(student.id) ?? [];
  const nextActivity = activities[0] ?? null;
  const progress = controller.progressByStudent.get(student.id) ?? null;
  const scoreInput = nextActivity
    ? {
        finalScore: nextActivity.finalScore,
        initialScore: nextActivity.initialScore,
        passed: nextActivity.passed,
        passingScore: nextActivity.passingScore,
        phase: nextActivity.phase,
        retryStartedAt: nextActivity.retryStartedAt,
        status: nextActivity.status,
      }
    : null;
  const hasScore =
    scoreInput !== null &&
    hasAttemptScoreContent(scoreInput, { compact: true });
  const learningSources = (
    controller.learningSourcesByStudent.get(student.id) ?? []
  ).filter(
    (source) =>
      source.sourceType !== "primary_vocab" &&
      source.displayLabel !== student.currentVocabBook,
  );
  const reviewCounts = studentPendingReviewCounts(controller, student);
  const assignmentBlockedReason =
    student.status === "blocked"
      ? "접속 차단 학생"
      : controller.readyDatasets.length === 0
        ? adminLearningText.assignmentModal.submit.blockedReason.noReadyDataset
        : null;
  const recommendedRange = assignmentRecommendationLabel(progress);
  const currentActivityRange =
    nextActivity?.primaryUnitLabels[0] ?? nextActivity?.unitLabels[0] ?? null;
  const showRecommendation =
    !nextActivity ||
    !currentActivityRange ||
    currentActivityRange !== recommendedRange;

  return (
    <SelectableRow
      actions={
        <>
          {nextActivity ? (
            <ButtonLink
              href={historyDetailHref(nextActivity)}
              size="small"
              variant="primary"
            >
              {adminLearningText.page.studentCard.view}
            </ButtonLink>
          ) : null}
          {controller.assignmentMode === "single" ? (
            <ActionWithReason reason={assignmentBlockedReason}>
              <Button
                disabled={assignmentBlockedReason !== null}
                onClick={() =>
                  controller.actions.openSingleAssignment(student.id)
                }
                size="small"
                variant={nextActivity ? "secondary" : "primary"}
              >
                {adminLearningText.page.studentCard.newAssignment}
              </Button>
            </ActionWithReason>
          ) : null}
        </>
      }
      checked={controller.selectedBulkStudentIds.includes(student.id)}
      checkboxId={`bulk-student-${student.id}`}
      onToggle={() => controller.actions.toggleBulkStudent(student.id)}
      selectionEnabled={controller.assignmentMode === "bulk"}
      disabled={student.status === "blocked"}
      selectionAriaLabel={formatContentText(
        adminLearningText.page.bulk.selectStudentAria,
        { student: student.displayName },
      )}
    >
      <ActivityRow
        main={
          <>
            <span className={learningRowStyles.identity}>
              <strong>{student.displayName}</strong>
              <MetaTagList>
                <MetaTag>
                  {student.schoolName ??
                    adminLearningText.page.studentCard.schoolMissing}
                </MetaTag>
                <MetaTag>
                  {student.gradeLabel ??
                    adminLearningText.page.studentCard.gradeMissing}
                </MetaTag>
              </MetaTagList>
            </span>
            <MetaTagList className={learningRowStyles.book}>
              <MetaTag>
                {student.currentVocabBook ??
                  adminLearningText.page.studentCard.wordbookMissing}
              </MetaTag>
              {learningSources.slice(0, 2).map((source) => (
                <MetaTag key={source.id}>
                  {learningSourceTypeLabel(source.sourceType)} ·{" "}
                  {source.displayLabel}
                </MetaTag>
              ))}
              {learningSources.length > 2 ? (
                <MetaTag>+{learningSources.length - 2}</MetaTag>
              ) : null}
              {reviewCounts.available > 0 ? (
                <MetaTag tone="warning">
                  {formatContentText(
                    adminLearningText.page.studentCard.wrongAvailable,
                    { count: reviewCounts.available },
                  )}
                </MetaTag>
              ) : reviewCounts.pending > 0 ? (
                <MetaTag>{adminLearningText.page.studentCard.wrongAssigned}</MetaTag>
              ) : null}
            </MetaTagList>
            {assignmentQueues.slice(0, 2).map((queue) => (
              <AssignmentQueueTags key={queue.seriesId} queue={queue} />
            ))}
            {assignmentQueues.length > 2 ? (
              <MetaTagList>
                <MetaTag>이어 배정 +{assignmentQueues.length - 2}</MetaTag>
              </MetaTagList>
            ) : null}
            <span className={learningRowStyles.recent}>
              {nextActivity ? (
                <>
                  {assignmentDisplayTitle(nextActivity) ? (
                    <strong>{assignmentDisplayTitle(nextActivity)}</strong>
                  ) : null}
                  <AssignmentMetaTags {...nextActivity} compact />
                </>
              ) : (
                <strong>{adminLearningText.page.studentCard.noActivity}</strong>
              )}
            </span>
            {showRecommendation ? (
              <MetaTagList>
                <MetaTag tone="warning">
                  {formatContentText(
                    adminLearningText.page.studentCard.recommendedRange,
                    { range: recommendedRange },
                  )}
                </MetaTag>
              </MetaTagList>
            ) : null}
          </>
        }
        score={
          hasScore && scoreInput ? (
            <AttemptScoreSummary compact {...scoreInput} />
          ) : undefined
        }
        timeline={
          nextActivity ? <ActivityStatusTimeline item={nextActivity} /> : null
        }
      />
    </SelectableRow>
  );
}
