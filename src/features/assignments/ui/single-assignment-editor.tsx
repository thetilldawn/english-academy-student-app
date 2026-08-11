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
import {
  DialogBody,
  DialogFooter,
} from "@/design-system/primitives/dialog/dialog";
import { Notice } from "@/design-system/patterns/feedback/feedback";
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
import {
  assignmentSubmitBlockerLabel,
  assignmentSubmitButtonLabel,
} from "../presentation/assignment-submit-blocker";
import { AssignmentRangeFields, assignmentUnitRangeLabel } from "./assignment-range-fields";
import { AssignmentReviewFields } from "./assignment-review-fields";
import { AssignmentSection } from "./assignment-section";
import { AssignmentSettingsFields } from "./assignment-settings-fields";
import { AssignmentSubmitAction } from "./assignment-submit-action";
import { AssignmentSummaryPanel } from "./assignment-summary-panel";
import styles from "./single-assignment-editor.module.css";

export type SingleAssignmentSubmitPresentation = {
  blockedReason: string | null;
  canSubmit: boolean;
  formId: string;
  label: string;
};

export function SingleAssignmentEditor({
  availableReviewLevel1,
  availableReviewLevel2,
  datasets,
  editTarget,
  formId: suppliedFormId,
  initialDatasetId,
  initialUnitId,
  onBusyChange,
  onConflict,
  onSubmitPresentationChange,
  onSucceeded,
  placement,
  progress,
  student,
  submitPlacement = "footer",
  units,
}: {
  availableReviewLevel1: number;
  availableReviewLevel2: number;
  datasets: readonly AssignmentDatasetItem[];
  editTarget: { assignmentId: string; studentId: string } | null;
  formId?: string;
  initialDatasetId: string;
  initialUnitId: string;
  onBusyChange?: (busy: boolean) => void;
  onConflict?: () => void;
  onSubmitPresentationChange?: (
    presentation: SingleAssignmentSubmitPresentation,
  ) => void;
  onSucceeded: (result: SingleAssignmentResult) => void;
  placement: "dialog" | "inline";
  progress: AssignmentProgressItem | null;
  student: AssignmentStudentItem;
  submitPlacement?: "footer" | "external";
  units: readonly AssignmentUnitItem[];
}) {
  const reactId = useId().replaceAll(":", "");
  const formId = suppliedFormId ?? `single-assignment-${reactId}`;
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
  const submitLabel = assignmentSubmitButtonLabel({
    busy,
    dirty: controller.dirty,
    editing: editTarget !== null,
    reviewMode: controller.state.draft.review.mode,
  });
  const blockedReason = assignmentSubmitBlockerLabel(controller.submitBlocker);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onSubmitPresentationChange?.({
      blockedReason,
      canSubmit: controller.canSubmit,
      formId,
      label: submitLabel,
    });
  }, [
    blockedReason,
    controller.canSubmit,
    formId,
    onSubmitPresentationChange,
    submitLabel,
  ]);

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
        className={placement === "inline" ? styles.inlineBody : undefined}
      >
        {controller.loadStatus === "loading" ? (
          <Notice role="status">
            {adminLearningText.assignmentModal.overview.loadingEdit}
          </Notice>
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
      {submitPlacement === "footer" ? (
        <DialogFooter
          className={placement === "inline" ? styles.inlineFooter : undefined}
        >
          <AssignmentSubmitAction
            blockedReason={blockedReason}
            canSubmit={controller.canSubmit}
            formId={formId}
            label={submitLabel}
          />
        </DialogFooter>
      ) : null}
    </>
  );
}
