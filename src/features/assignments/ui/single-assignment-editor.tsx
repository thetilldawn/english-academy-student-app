"use client";

import { useCallback, useEffect, useId, useMemo, type FormEvent } from "react";
import { toast } from "sonner";

import {
  AssignmentEditorLayout,
  AssignmentEditorSettings,
  AssignmentEditorSummary,
} from "@/components/assignment-editor-ui";
import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import { Button } from "@/design-system/primitives/button/button";
import {
  DialogBody,
  DialogFooter,
} from "@/design-system/primitives/dialog/dialog";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";

import type {
  AssignmentDatasetItem,
  AssignmentProgressItem,
  AssignmentStudentItem,
  AssignmentUnitItem,
} from "../catalog-types";
import {
  createInitialSingleAssignmentDraft,
  useAssignmentController,
  type AssignmentControllerSource,
  type SingleAssignmentResult,
} from "../controller/use-assignment-controller";
import type { SingleAssignmentDraft } from "../domain/model";
import { AssignmentRangeFields, assignmentUnitRangeLabel } from "./assignment-range-fields";
import { AssignmentReviewFields } from "./assignment-review-fields";
import { AssignmentSection } from "./assignment-section";
import { AssignmentSettingsFields } from "./assignment-settings-fields";
import { AssignmentSummaryPanel } from "./assignment-summary-panel";
import styles from "./single-assignment-editor.module.css";

export function SingleAssignmentEditor({
  availableReviewLevel1,
  availableReviewLevel2,
  datasets,
  editTarget,
  embedded,
  initialDatasetId,
  initialUnitId,
  onBusyChange,
  onConflict,
  onSucceeded,
  progress,
  student,
  units,
}: {
  availableReviewLevel1: number;
  availableReviewLevel2: number;
  datasets: readonly AssignmentDatasetItem[];
  editTarget: { assignmentId: string; studentId: string } | null;
  embedded: boolean;
  initialDatasetId: string;
  initialUnitId: string;
  onBusyChange?: (busy: boolean) => void;
  onConflict?: () => void;
  onSucceeded: (result: SingleAssignmentResult) => void;
  progress: AssignmentProgressItem | null;
  student: AssignmentStudentItem;
  units: readonly AssignmentUnitItem[];
}) {
  const reactId = useId().replaceAll(":", "");
  const formId = `single-assignment-${reactId}`;
  const fallbackDraft = useMemo(
    () =>
      createInitialSingleAssignmentDraft({
        datasetId: initialDatasetId,
        orderedUnitIds: initialUnitId ? [initialUnitId] : [],
        studentId: student.id,
      }),
    [initialDatasetId, initialUnitId, student.id],
  );
  const source = useMemo<AssignmentControllerSource>(
    () =>
      editTarget
        ? {
            assignmentId: editTarget.assignmentId,
            fallbackDraft,
            kind: "edit",
            studentId: editTarget.studentId,
          }
        : { initialDraft: fallbackDraft, kind: "create" },
    [editTarget, fallbackDraft],
  );
  const automaticTitleForDraft = useCallback(
    (draft: SingleAssignmentDraft, capacity: { wrongEligible: number } | null) => {
      const dataset = datasets.find(
        (candidate) => candidate.id === draft.range.datasetId,
      );
      const labels = draft.range.orderedUnitIds.map(
        (unitId) =>
          units.find((unit) => unit.id === unitId)?.displayName ??
          adminLearningText.assignmentModal.range.unknownUnit,
      );
      return [
        dataset ? cataloguedDatasetDisplayLabel(dataset) : null,
        assignmentUnitRangeLabel(labels),
        draft.review.mode === "pending"
          ? formatContentText(
              adminLearningText.assignmentModal.overview.includedWrong,
              { count: capacity?.wrongEligible ?? 0 },
            )
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
    },
    [datasets, units],
  );
  const controller = useAssignmentController({
    automaticTitleForDraft,
    capacityErrorMessage: adminLearningText.assignmentModal.errors.capacity,
    editLoadErrorMessage: adminLearningText.assignmentModal.errors.editLoad,
    genericErrorMessage: adminLearningText.assignmentModal.errors.generic,
    onConflict,
    source,
  });
  const busy = controller.state.submission.status === "submitting";

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = await controller.actions.submit();
    if (!outcome.ok) {
      toast.error(outcome.message);
      return;
    }
    const edited = "status" in outcome.result;
    toast.success(
      formatContentText(
        edited
          ? adminLearningText.assignmentModal.success.edited
          : controller.state.draft.review.mode === "pending"
            ? adminLearningText.assignmentModal.success.assignedWithWrong
            : adminLearningText.assignmentModal.success.assigned,
        { student: student.displayName },
      ),
    );
    onSucceeded(outcome.result);
  }

  return (
    <>
      <DialogBody
        className={embedded ? styles.embeddedBody : undefined}
      >
        {controller.loadStatus === "loading" ? (
          <div className="notice" role="status">
            {adminLearningText.assignmentModal.overview.loadingEdit}
          </div>
        ) : null}
        <form
          aria-busy={busy}
          className={styles.form}
          id={formId}
          onSubmit={submit}
        >
          <fieldset
            className={styles.fieldset}
            disabled={busy || controller.loadStatus !== "ready"}
          >
            <legend className="sr-only">
              {adminLearningText.assignmentModal.overview.formAria}
            </legend>
            <AssignmentEditorLayout>
              <AssignmentEditorSettings>
                <AssignmentSection
                  help={adminLearningText.assignmentModal.range.help}
                  helpLabel={formatContentText(
                    adminLearningText.assignmentModal.range.helpAria,
                    { unit: adminLearningText.assignmentModal.range.unitTerm },
                  )}
                  index={1}
                  title={adminLearningText.assignmentModal.range.title}
                >
                  <AssignmentRangeFields
                    controller={controller}
                    datasets={datasets}
                    progress={progress}
                    units={units}
                  />
                  <AssignmentReviewFields
                    availableLevel1={availableReviewLevel1}
                    availableLevel2={availableReviewLevel2}
                    controller={controller}
                  />
                </AssignmentSection>
                <AssignmentSection
                  help={adminLearningText.assignmentModal.conditions.help}
                  helpLabel={
                    adminLearningText.assignmentModal.conditions.helpAria
                  }
                  index={2}
                  title={adminLearningText.assignmentModal.conditions.title}
                >
                  <AssignmentSettingsFields
                    controller={controller}
                    fieldIdPrefix={formId}
                  />
                </AssignmentSection>
              </AssignmentEditorSettings>
              <AssignmentEditorSummary busy={busy}>
                <AssignmentSummaryPanel
                  controller={controller}
                  datasets={datasets}
                  units={units}
                />
              </AssignmentEditorSummary>
            </AssignmentEditorLayout>
          </fieldset>
        </form>
      </DialogBody>
      <DialogFooter className={embedded ? styles.embeddedFooter : undefined}>
        <Button
          disabled={!controller.canSubmit}
          form={formId}
          size="large"
          type="submit"
          variant="primary"
        >
          {busy
            ? editTarget
              ? adminLearningText.assignmentModal.submit.saving
              : adminLearningText.assignmentModal.submit.assigning
            : editTarget
              ? controller.dirty
                ? adminLearningText.assignmentModal.submit.saveChanges
                : adminLearningText.assignmentModal.submit.noChanges
              : controller.state.draft.review.mode === "pending"
                ? adminLearningText.assignmentModal.submit.assignWithWrong
                : adminLearningText.assignmentModal.submit.assign}
        </Button>
      </DialogFooter>
    </>
  );
}
