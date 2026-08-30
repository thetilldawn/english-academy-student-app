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
import { useAssignmentDatasetUnitCatalog } from "../controller/use-assignment-dataset-unit-catalog";
import type { SingleAssignmentDraft } from "../domain/model";
import { buildAutomaticAssignmentTitle } from "../presentation/assignment-automatic-title";
import {
  assignmentSubmitBlockerLabel,
  assignmentSubmitButtonLabel,
} from "../presentation/assignment-submit-blocker";
import { newAssignmentDraftDefaults } from "../presentation/new-assignment-defaults";
import { hydrateSingleAssignmentDraftFromEditResponse } from "../api/edit-draft-adapter";
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
  initialEditDraft,
  initialUnitIds,
  onBusyChange,
  onConflict,
  onSubmitPresentationChange,
  onSucceeded,
  placement,
  progress,
  student,
  submitPlacement = "footer",
  units: initialUnits,
}: SingleAssignmentEditorProps) {
  const unitCatalog = useAssignmentDatasetUnitCatalog(initialUnits);
  const units = unitCatalog.units;
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
  const hydratedEditDraft = useMemo(
    () => initialEditDraft
      ? hydrateSingleAssignmentDraftFromEditResponse(initialEditDraft)
      : null,
    [initialEditDraft],
  );
  const source = useMemo<AssignmentControllerSource>(
    () =>
      editTarget
        ? {
            assignmentId: editTarget.assignmentId,
            fallbackDraft,
            initialDraft: hydratedEditDraft ?? undefined,
            kind: "edit",
            studentId: editTarget.studentId,
          }
        : { initialDraft: fallbackDraft, kind: "create" },
    [editTarget, fallbackDraft, hydratedEditDraft],
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
  const ensureDatasetUnits = unitCatalog.actions.ensureDataset;
  useEffect(() => {
    if (controller.loadStatus !== "ready") return;
    void ensureDatasetUnits(controller.state.draft.range.datasetId);
  }, [
    controller.loadStatus,
    controller.state.draft.range.datasetId,
    ensureDatasetUnits,
  ]);
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
      dirty: controller.loadStatus === "ready" && controller.dirty,
      formId,
      label: submitLabel,
    });
  }, [
    actionReason,
    controller.dirty,
    controller.loadStatus,
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
        {controller.loadStatus === "loading" ? (
          <div
            aria-busy="true"
            className={styles.editorSkeleton}
            role="status"
          >
            <span className={styles.skeletonLabel}>
              {adminLearningText.assignmentModal.overview.loadingEdit}
            </span>
            {[1, 2, 3, 4].map((index) => (
              <span aria-hidden="true" className={styles.skeletonSection} key={index}>
                <span />
                <span />
                <span />
              </span>
            ))}
          </div>
        ) : controller.loadStatus === "error" ? (
          <Notice role="alert" tone="danger">
            {controller.message || adminLearningText.assignmentModal.errors.editLoad}
          </Notice>
        ) : (
          <form
            aria-busy={busy}
            className={styles.form}
            id={formId}
            noValidate
            onSubmit={submit}
            ref={formRef}
          >
            <fieldset className={styles.fieldset} disabled={busy}>
              <legend className="sr-only">
                {adminLearningText.assignmentModal.overview.formAria}
              </legend>
              <SingleAssignmentEditorSections
                controller={controller}
                datasets={datasets}
                editPurpose={editTarget?.purpose ?? null}
                editSnapshot={initialEditDraft}
                fieldErrors={fieldErrors}
                formId={formId}
                progress={progress}
                units={units}
                unitLoadState={unitCatalog.state}
                onRetryUnits={() => void unitCatalog.actions.retry()}
              />
            </fieldset>
          </form>
        )}
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
