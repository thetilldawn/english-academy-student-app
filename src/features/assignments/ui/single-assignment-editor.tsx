"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import {
  DialogBody,
  DialogFooter,
} from "@/design-system/primitives/dialog/dialog";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import {
  createInitialSingleAssignmentDraft,
  useAssignmentController,
  type AssignmentControllerSource,
} from "../controller/use-assignment-controller";
import type { SingleAssignmentDraft } from "../domain/model";
import { buildAutomaticAssignmentTitle } from "../presentation/assignment-automatic-title";
import {
  assignmentSubmitBlockerLabel,
  assignmentSubmitButtonLabel,
} from "../presentation/assignment-submit-blocker";
import { newAssignmentDraftDefaults } from "../presentation/new-assignment-defaults";
import { SingleAssignmentEditorSections } from "./single-assignment-editor-sections";
import { AssignmentSubmitAction } from "./assignment-submit-action";
import type { SingleAssignmentEditorProps } from "./single-assignment-editor.types";
import { useEditAssignmentValidation } from "./use-edit-assignment-validation";
import styles from "./single-assignment-editor.module.css";

export function SingleAssignmentEditor({
  datasets,
  editTarget,
  formId: suppliedFormId,
  initialDatasetId,
  initialUnitIds,
  onBusyChange,
  onConflict,
  onSubmitPresentationChange,
  onSucceeded,
  placement,
  progress,
  student,
  submitPlacement = "footer",
  units,
}: SingleAssignmentEditorProps) {
  const reactId = useId().replaceAll(":", "");
  const formId = suppliedFormId ?? `single-assignment-${reactId}`;
  const firstDatasetUnitId = useMemo(
    () =>
      units
        .filter((unit) => unit.datasetId === initialDatasetId)
        .toSorted((left, right) => left.sortIndex - right.sortIndex)[0]?.id ??
      "",
    [initialDatasetId, units],
  );
  const createDefaults = useMemo(
    () =>
      newAssignmentDraftDefaults(
        progress,
        initialDatasetId,
        firstDatasetUnitId,
      ),
    [firstDatasetUnitId, initialDatasetId, progress],
  );
  const fallbackDraft = useMemo(
    () =>
      createInitialSingleAssignmentDraft({
        datasetId: initialDatasetId,
        deadline: createDefaults.deadline,
        exam: createDefaults.exam,
        orderedUnitIds: initialUnitIds
          ? [...initialUnitIds]
          : createDefaults.orderedUnitIds,
        studentId: student.id,
      }),
    [createDefaults, initialDatasetId, initialUnitIds, student.id],
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
    (
      draft: SingleAssignmentDraft,
      capacity: { wrongEligible: number } | null,
    ) =>
      buildAutomaticAssignmentTitle(draft, capacity, datasets, units),
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
  const {
    canSubmit: validationCanSubmit,
    fieldErrors,
    focusFirstInvalidField,
    formRef,
    prepareSubmit,
    showBlockedReason,
  } = useEditAssignmentValidation({ blockedReason, controller });
  const actionReason = controller.message ||
    (showBlockedReason ? blockedReason : null);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onSubmitPresentationChange?.({
      blockedReason: actionReason,
      canSubmit: validationCanSubmit,
      formId,
      label: submitLabel,
    });
  }, [
    actionReason,
    formId,
    onSubmitPresentationChange,
    validationCanSubmit,
    submitLabel,
  ]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prepareSubmit()) return;
    const outcome = await controller.actions.submit();
    if (!outcome.ok) {
      toast.error(outcome.message);
      focusFirstInvalidField();
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
        <div
          aria-live="polite"
          className={styles.loadStatus}
          data-active={controller.loadStatus === "loading"}
        >
          {controller.loadStatus === "loading" ? (
            <Notice role="status">
              {adminLearningText.assignmentModal.overview.loadingEdit}
            </Notice>
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </div>
        <form
          aria-busy={busy}
          className={styles.form}
          id={formId}
          noValidate
          onSubmit={submit}
          ref={formRef}
        >
          <fieldset
            className={styles.fieldset}
            disabled={busy || controller.loadStatus !== "ready"}
          >
            <legend className="sr-only">
              {adminLearningText.assignmentModal.overview.formAria}
            </legend>
            <SingleAssignmentEditorSections
              controller={controller}
              datasets={datasets}
              editPurpose={editTarget?.purpose ?? null}
              fieldErrors={fieldErrors}
              formId={formId}
              progress={progress}
              units={units}
            />
          </fieldset>
        </form>
      </DialogBody>
      {submitPlacement === "footer" ? (
        <DialogFooter
          className={placement === "inline" ? styles.inlineFooter : undefined}
        >
          <AssignmentSubmitAction
            blockedReason={actionReason}
            canSubmit={validationCanSubmit}
            formId={formId}
            label={submitLabel}
            reasonLayout="remaining-center"
            reasonPosition="before"
          />
        </DialogFooter>
      ) : null}
    </>
  );
}
