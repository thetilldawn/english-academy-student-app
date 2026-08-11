import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { commonText } from "@/content/ko/common";
import {
  DialogBody,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { IconButton } from "@/design-system/primitives/button/button";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";
import { StudentLearningActivityList } from "@/features/history/ui/student-learning-activity-list";
import { learningSourceTypeLabel } from "@/lib/admin/learning-sources";

import type { AssignmentWorkspaceController } from "../controller/use-assignment-workspace";
import {
  assignmentRecommendationLabel,
  assignmentRecommendationReasonLabel,
} from "../presentation/assignment-recommendation";
import { SingleAssignmentEditor } from "./single-assignment-editor";
import styles from "./assignment-workspace.module.css";

export function AssignmentStudentDialog({
  controller,
}: {
  controller: AssignmentWorkspaceController;
}) {
  const student = controller.selectedStudent;
  if (!student) return null;
  const assigning = controller.dialogView === "assign";
  const assignmentScheduled =
    controller.selectedProgress?.nextAssignmentBlockedReason === "scheduled";

  function handleSucceeded() {
    controller.actions.refresh();
    controller.actions.closeStudent();
  }

  return (
    <DialogFrame
      aria-labelledby="assignment-dialog-title"
      closeDisabled={controller.editorBusy}
      fullScreenMobile
      height="large"
      layout="body-footer"
      onRequestClose={controller.actions.closeStudent}
      size="extra-wide"
    >
      <DialogHeader
        backLabel={commonText.modal.back}
        closeLabel={commonText.modal.close}
        onBack={
          assigning
            ? () => {
                controller.actions.setEditorBusy(false);
                controller.actions.setDialogView("overview");
              }
            : undefined
        }
      >
        <div>
          <h2 id="assignment-dialog-title">
            {assigning
              ? adminLearningText.assignmentModal.header.createTitle
              : student.displayName}
          </h2>
          <p>
            {assigning
              ? student.displayName
              : [student.schoolName, student.gradeLabel]
                  .filter(Boolean)
                  .join(" · ") ||
                adminLearningText.assignmentModal.overview.studentInfoMissing}
          </p>
        </div>
      </DialogHeader>

      {assigning ? (
        <SingleAssignmentEditor
          availableReviewLevel1={controller.availableReviewLevel1}
          availableReviewLevel2={controller.availableReviewLevel2}
          datasets={controller.data.datasets}
          editTarget={null}
          placement="dialog"
          initialDatasetId={controller.selectedInitialDatasetId}
          key={`${student.id}:${controller.selectedInitialDatasetId}:create`}
          onBusyChange={controller.actions.setEditorBusy}
          onConflict={controller.actions.refresh}
          onSucceeded={handleSucceeded}
          progress={controller.selectedProgress}
          student={student}
          units={controller.data.units}
        />
      ) : (
        <DialogBody className={styles.overviewBody}>
          <section className={styles.studentOverview}>
            <div className={styles.sourceRow}>
              <div>
                <span>
                  {adminLearningText.assignmentModal.overview.recentWordbook}
                </span>
                <strong>
                  {student.currentVocabBook ??
                    adminLearningText.assignmentModal.overview.unselected}
                </strong>
              </div>
              <IconButton
                aria-label={
                  adminLearningText.assignmentModal.overview.openAssignmentAria
                }
                className={styles.addButton}
                disabled={
                  controller.readyDatasets.length === 0 || assignmentScheduled
                }
                onClick={() => controller.actions.setDialogView("assign")}
                variant="quiet"
              >
                +
              </IconButton>
            </div>

            {controller.selectedLearningSources.length > 0 ? (
              <div className={styles.learningTags}>
                <MetaTagList>
                  {controller.selectedLearningSources.map((source) => (
                    <MetaTag
                      key={source.id}
                      tone={
                        source.sourceType === "exam_vocab"
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {learningSourceTypeLabel(source.sourceType)} ·{" "}
                      {source.displayLabel}
                    </MetaTag>
                  ))}
                </MetaTagList>
              </div>
            ) : null}

            <div className={styles.learningTags}>
              <MetaTagList>
                <MetaTag tone="warning">
                  {formatContentText(
                    adminLearningText.assignmentModal.overview
                      .nextRecommendation,
                    {
                      range: assignmentRecommendationLabel(
                        controller.selectedProgress,
                      ),
                    },
                  )}
                </MetaTag>
                <MetaTag>
                  {formatContentText(
                    adminLearningText.assignmentModal.overview.unresolvedWrong,
                    {
                      count:
                        controller.selectedCurrentWrongCounts.wrongWordCount,
                    },
                  )}
                </MetaTag>
                <MetaTag>
                  {formatContentText(
                    adminLearningText.assignmentModal.overview.pendingWrong,
                    { count: controller.selectedPendingReviewCount },
                  )}
                </MetaTag>
              </MetaTagList>
              <HelpTip
                label={
                  adminLearningText.assignmentModal.overview
                    .recommendationHelpAria
                }
              >
                {assignmentRecommendationReasonLabel(
                  controller.selectedProgress,
                )}
              </HelpTip>
            </div>

            {controller.readyDatasets.length === 0 ? (
              <div className={styles.notice} role="status">
                {adminLearningText.assignmentModal.overview.noReadyDataset}
              </div>
            ) : null}
            {assignmentScheduled ? (
              <div className={styles.notice} role="status">
                {
                  adminLearningText.assignmentModal.submit.blockedReason
                    .scheduledAssignment
                }
              </div>
            ) : null}
            <div className={styles.sectionHeading}>
              <h3>
                {adminLearningText.assignmentModal.overview.recentActivity}
              </h3>
              <span className={styles.sectionSummary}>
                {formatContentText(
                  adminLearningText.assignmentModal.overview.activityCount,
                  { count: controller.selectedActivities.length },
                )}
              </span>
            </div>
            <StudentLearningActivityList
              items={controller.selectedActivities}
            />
          </section>
        </DialogBody>
      )}
    </DialogFrame>
  );
}
