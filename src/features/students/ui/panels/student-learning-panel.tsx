"use client";

import { useMemo } from "react";

import { StudentLearningActivityList } from "@/features/history/ui/student-learning-activity-list";
import { CountBadge } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import {
  Field,
  FieldLabel,
  Select,
} from "@/design-system/primitives/form/field";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import { adminStudentsText } from "@/content/ko/admin-students";
import { adminLearningText } from "@/content/ko/admin-learning";
import { ActionWithReason } from "@/design-system/patterns/action-reason/action-reason";
import { EmptyState } from "@/design-system/patterns/feedback/feedback";
import { formatContentText } from "@/content/format";
import {
  cataloguedDatasetDisplayLabel,
  groupCataloguedDatasets,
} from "@/lib/admin/dataset-catalog";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import type { StudentManagementData } from "../../model";
import { StudentLearningSourceList } from "./student-learning-source-list";
import { StudentVocabBookHistoryList } from "./student-vocab-book-history-list";
import { StudentWrongWordPanel } from "./student-wrong-word-panel";
import styles from "../student-detail.module.css";

function AssignmentAction({
  blockedReason,
  onAssign,
}: {
  blockedReason: string | null;
  onAssign: () => void;
}) {
  return (
    <div className={styles.assignmentAction}>
      <strong className={inlineHelpClassName}>
        {adminStudentsText.learning.nextVocabularyTitle}
        <HelpTip label={adminStudentsText.learning.nextVocabularyHelpAria}>
          {adminStudentsText.learning.nextVocabularyHelp}
        </HelpTip>
      </strong>
      <ActionWithReason reason={blockedReason}>
        <Button
          disabled={blockedReason !== null}
          onClick={onAssign}
          variant="primary"
        >
          {adminStudentsText.learning.assign}
        </Button>
      </ActionWithReason>
    </div>
  );
}
export function StudentLearningPanel({
  controller,
  data,
}: {
  controller: StudentDetailController;
  data: StudentManagementData;
}) {
  const student = controller.selectedStudent;
  const datasetGroups = useMemo(
    () => groupCataloguedDatasets(data.datasets),
    [data.datasets],
  );
  const hasReadyAssignmentDataset = useMemo(
    () =>
      data.assignmentDatasets.some(
        (dataset) =>
          dataset.status === "ready" &&
          dataset.isActive &&
          dataset.isAssignable,
      ),
    [data.assignmentDatasets],
  );
  if (!student) return null;
  const assignmentBlockedReason = controller.interactionBusy
    ? adminLearningText.assignmentModal.submit.blockedReason.processing
    : hasReadyAssignmentDataset
      ? null
      : adminLearningText.assignmentModal.submit.blockedReason.noReadyDataset;

  const sources = data.learningSources.filter(
    (source) => source.studentId === student.id,
  );
  const currentHistory = data.currentHistory.filter(
    (item) => item.studentId === student.id,
  );
  const vocabBookHistory = data.vocabBookHistory.filter(
    (item) => item.studentId === student.id,
  );
  const route = controller.route;

  if (route.kind === "source") {
    return (
      <section className={`${styles.panel} ${styles.learningView}`}>
        {route.view === "vocab" ? (
          <>
            <AssignmentAction
              blockedReason={assignmentBlockedReason}
              onAssign={() =>
                controller.actions.openAssignment(
                  route.datasetId || student.currentVocabDatasetId || "",
                )
              }
            />
            <StudentWrongWordPanel
              active
              cachedAt={
                controller.wrongHistoryByStudent[student.id]?.loadedAt ?? null
              }
              cachedHistory={
                controller.wrongHistoryByStudent[student.id]?.history ?? null
              }
              initialCurriculumStage={student.readingCurriculumStage}
              initialDatasetId={route.datasetId}
              initialReadingContextSyncStatus={
                student.readingContextSyncStatus
              }
              key={`${student.id}:${route.datasetId}`}
              onDataUpdated={controller.actions.refreshData}
              onLoaded={controller.actions.cacheWrongWordHistory}
              studentId={student.id}
            />
          </>
        ) : (
          <EmptyState>
            {adminStudentsText.learning.passagePending}
          </EmptyState>
        )}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="student-learning-tab"
      className={`${styles.panel} ${styles.learningView}`}
      id="student-learning-panel"
      role="tabpanel"
    >
      <StudentLearningSourceList
        fallbackPrimaryLabel={student.currentVocabBook}
        onOpen={controller.actions.openSource}
        sources={sources}
      />
      <AssignmentAction
        blockedReason={assignmentBlockedReason}
        onAssign={() =>
          controller.actions.openAssignment(student.currentVocabDatasetId ?? "")
        }
      />
      <div className={styles.wordbookForm}>
        <Field as="label">
          <FieldLabel as="span">
            {adminStudentsText.learning.recentWordbookChange}
          </FieldLabel>
          <Select
            onChange={(event) =>
              controller.actions.setProfileField("datasetId", event.target.value)
            }
            value={controller.profile.datasetId}
          >
            <option value="">{adminStudentsText.learning.chooseLater}</option>
            {controller.profile.datasetId &&
            !data.datasets.some(
              (dataset) => dataset.id === controller.profile.datasetId,
            ) ? (
              <option disabled value={controller.profile.datasetId}>
                {student.currentVocabBook ??
                  adminStudentsText.learning.previousWordbook}{" "}
                · {adminStudentsText.learning.assignmentClosed}
              </option>
            ) : null}
            {datasetGroups.map((group) => (
              <optgroup key={group.group} label={group.label}>
                {group.datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {cataloguedDatasetDisplayLabel(dataset)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Button
          disabled={
            controller.interactionBusy ||
            controller.profile.datasetId ===
              (student.currentVocabDatasetId ?? "")
          }
          onClick={() => void controller.actions.saveCurrentDataset()}
          variant="secondary"
        >
          {adminStudentsText.learning.save}
        </Button>
      </div>
      <StudentVocabBookHistoryList
        currentDatasetId={student.currentVocabDatasetId}
        datasets={data.assignmentDatasets}
        items={vocabBookHistory}
      />
      <div className={styles.sectionHeading}>
        <h3>{adminStudentsText.learning.recentActivity}</h3>
        <CountBadge>
          {formatContentText(adminStudentsText.learning.activityCount, {
            count: currentHistory.length,
          })}
        </CountBadge>
      </div>
      <StudentLearningActivityList initialLimit={5} items={currentHistory} />
    </section>
  );
}
