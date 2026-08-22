"use client";

import { useCallback, useEffect, useId, useMemo, type FormEvent } from "react";
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
import { AssignmentRangeFields } from "./assignment-range-fields";
import { AssignmentSection } from "./assignment-section";
import { AssignmentSettingsFields } from "./assignment-settings-fields";
import { AssignmentSubmitAction } from "./assignment-submit-action";
import { AssignmentSummaryPanel } from "./assignment-summary-panel";
import type { SingleAssignmentEditorProps } from "./single-assignment-editor.types";
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
  const actionReason = controller.message || blockedReason;

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onSubmitPresentationChange?.({
      blockedReason: actionReason,
      canSubmit: controller.canSubmit,
      formId,
      label: submitLabel,
    });
  }, [
    actionReason,
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
          onSubmit={submit}
        >
          <fieldset
            className={styles.fieldset}
            disabled={busy || controller.loadStatus !== "ready"}
          >
            <legend className="sr-only">
              {adminLearningText.assignmentModal.overview.formAria}
            </legend>
            <div className={styles.sections}>
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
                    part="conditions"
                  />
                </AssignmentSection>
                <AssignmentSection
                  help="제한시간과 응시 마감 사용 여부를 정합니다."
                  helpLabel="시험 일정 설명"
                  index={3}
                  title="시험 일정"
                >
                  <AssignmentSettingsFields
                    controller={controller}
                    fieldIdPrefix={formId}
                    part="schedule"
                  />
                </AssignmentSection>
                <AssignmentSection
                  help="저장될 범위와 시험 조건을 마지막으로 확인합니다."
                  helpLabel="시험 미리보기 설명"
                  index={4}
                  title="미리보기"
                >
                <AssignmentSummaryPanel
                  controller={controller}
                  datasets={datasets}
                  units={units}
                />
                </AssignmentSection>
            </div>
          </fieldset>
        </form>
      </DialogBody>
      {submitPlacement === "footer" ? (
        <DialogFooter
          className={placement === "inline" ? styles.inlineFooter : undefined}
        >
          <AssignmentSubmitAction
            blockedReason={actionReason}
            canSubmit={controller.canSubmit}
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
