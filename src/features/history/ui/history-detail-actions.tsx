"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { adminHistoryText } from "@/content/ko/admin-history";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import type { SingleAssignmentResult } from "@/features/assignments/controller/use-assignment-controller";
import { SingleAssignmentEditor } from "@/features/assignments/ui/single-assignment-editor";
import { isStudentAssignmentEditable } from "@/lib/admin/assignment-edit";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { historyDetailHref } from "@/lib/admin/history-route";
import { newAssignmentDefaultUnitId } from "@/lib/admin/new-assignment-range";
import {
  emptyPendingReviewCounts,
  indexStudentPendingReviewSummaries,
  pendingReviewSummaryKey,
} from "@/lib/admin/review-queue-summary";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import { AdminHistoryActions } from "./admin-history-actions";
import styles from "./history-detail-actions.module.css";

export function HistoryDetailActions({
  editorData,
  item,
  mode,
}: {
  editorData: AssignmentManagerData | null;
  item: AssignmentHistorySummary;
  mode: "page" | "overlay";
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreEditFocusRef = useRef(false);
  const editorModel = useMemo(() => {
    if (!editorData) return null;
    const student = editorData.students.find(
      (candidate) => candidate.id === item.studentId,
    );
    if (!student) return null;
    const readyDatasets = editorData.datasets.filter(
      (dataset) =>
        dataset.status === "ready" &&
        dataset.isActive &&
        dataset.isAssignable,
    );
    const initialDatasetId = readyDatasets.some(
      (dataset) => dataset.id === item.datasetId,
    )
      ? item.datasetId
      : readyDatasets.some(
            (dataset) => dataset.id === student.currentVocabDatasetId,
          )
        ? student.currentVocabDatasetId!
        : readyDatasets[0]?.id ?? "";
    const progress =
      editorData.progress.find(
        (candidate) => candidate.studentId === student.id,
      ) ?? null;
    const preferredUnitId = item.primaryUnitIds.find((unitId) =>
      editorData.units.some(
        (unit) =>
          unit.id === unitId && unit.datasetId === initialDatasetId,
      ),
    );
    const pendingIndex = indexStudentPendingReviewSummaries(
      editorData.pendingReviewSummaries,
    );
    const reviewCounts = initialDatasetId
      ? (pendingIndex.byStudentDataset.get(
          pendingReviewSummaryKey(student.id, initialDatasetId),
        ) ?? emptyPendingReviewCounts())
      : emptyPendingReviewCounts();

    return {
      availableReviewLevel1:
        reviewCounts.pendingLevel1Count - reviewCounts.reservedLevel1Count,
      availableReviewLevel2:
        reviewCounts.pendingLevel2Count - reviewCounts.reservedLevel2Count,
      datasets: editorData.datasets,
      initialDatasetId,
      initialUnitId:
        preferredUnitId ??
        newAssignmentDefaultUnitId(progress, initialDatasetId),
      progress,
      student,
      units: editorData.units,
    };
  }, [editorData, item.datasetId, item.primaryUnitIds, item.studentId]);

  useEffect(() => {
    if (editing) {
      editorHeadingRef.current?.focus();
      return;
    }
    if (restoreEditFocusRef.current) {
      restoreEditFocusRef.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  function closeEditor() {
    restoreEditFocusRef.current = true;
    setEditing(false);
  }

  function leaveDetail() {
    if (mode === "overlay") {
      const refreshParent = () => {
        window.requestAnimationFrame(() => router.refresh());
      };
      window.addEventListener("popstate", refreshParent, { once: true });
      router.back();
      return;
    }
    window.location.replace("/admin/results");
  }

  function handleSucceeded(result: SingleAssignmentResult) {
    setEditing(false);
    if ("replacementAssignmentId" in result) {
      router.replace(
        historyDetailHref({
          assignmentId: result.replacementAssignmentId,
          attemptId: null,
          studentId: result.studentId,
        }),
        { scroll: false },
      );
    }
    router.refresh();
  }

  if (editing && editorModel) {
    return (
      <section
        aria-labelledby="history-detail-editor-title"
        className={styles.editor}
      >
        <div className={styles.editorHeading}>
          <h2
            id="history-detail-editor-title"
            ref={editorHeadingRef}
            tabIndex={-1}
          >
            {adminHistoryText.actions.edit}
          </h2>
          <Button
            disabled={editorBusy}
            onClick={closeEditor}
            size="small"
            variant="quiet"
          >
            {adminHistoryText.detailModal.close}
          </Button>
        </div>
        <SingleAssignmentEditor
          {...editorModel}
          editTarget={{
            assignmentId: item.assignmentId,
            studentId: item.studentId,
          }}
          embedded
          key={`${item.studentId}:${item.assignmentId}`}
          onBusyChange={setEditorBusy}
          onConflict={() => router.refresh()}
          onSucceeded={handleSucceeded}
        />
      </section>
    );
  }

  return (
    <div className={styles.actions}>
      {editorModel && isStudentAssignmentEditable(item) ? (
        <Button ref={editButtonRef} onClick={() => setEditing(true)}>
          {adminHistoryText.actions.edit}
        </Button>
      ) : null}
      <AdminHistoryActions
        item={item}
        onMutated={leaveDetail}
        refreshAfterMutation={false}
        showDetailLink={false}
      />
      {!item.studentDeleted ? (
        <ButtonLink href={`/admin/students?student=${item.studentId}`}>
          {adminHistoryText.detailModal.openStudent}
        </ButtonLink>
      ) : null}
    </div>
  );
}
